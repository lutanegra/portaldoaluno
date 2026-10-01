import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendAudit } from '@/lib/audit';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos, accHasNucleo, type PanelAccount } from '@/lib/panelCredentials';
import { exigirConformidadeAluno } from '@/lib/alunoGate';
import { resolverAtor } from '@/lib/ator';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const dir = (date: string) => `checkins/${date}`;
const jsonKey = (date: string, sid: string) => `checkins/${date}/${sid}.json`;
const delKey  = (date: string, sid: string) => `checkins/${date}/${sid}.deleted`;

// Tolerâncias das travas de presença
const TOLERANCIA_MIN = 15;            // minutos antes/depois da janela de treino
const RAIO_METROS = 200;              // raio máximo do local de treino
const RAIO_SEM_COORDS = 800;          // quando o núcleo não tem lat/lng cadastrados

async function ensureBucket() {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some(b => b.name === BUCKET)) {
    await admin.storage.createBucket(BUCKET, { public: false });
  }
}

/** Resolve o núcleo (tenants) pelo nome ou slug do aluno. */
async function findTenant(nome: string) {
  const clean = String(nome || '').trim();
  if (!clean || clean === 'Sem núcleo') return null;
  const { data } = await admin
    .from('tenants')
    .select('nome, slug, dias_treino, lat, lng, endereco')
    .or(`nome.ilike.${clean},slug.eq.${clean}`)
    .limit(1)
    .maybeSingle();
  return data || null;
}

function distanciaMetros(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// GET /api/checkins?date=YYYY-MM-DD
export async function GET(req: Request) {
  const date = new URL(req.url).searchParams.get('date')
    || new Date().toISOString().split('T')[0];

  await ensureBucket();

  const { data: files, error } = await admin.storage.from(BUCKET).list(dir(date));

  if (error) {
    console.error('[checkins GET] storage error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!files || files.length === 0) return NextResponse.json([]);

  const deletedIds = new Set(
    files.filter(f => f.name.endsWith('.deleted')).map(f => f.name.replace('.deleted', ''))
  );
  const active = files.filter(
    f => f.name.endsWith('.json') && !deletedIds.has(f.name.replace('.json', ''))
  );
  if (active.length === 0) return NextResponse.json([]);

  const records = await Promise.all(
    active.map(async f => {
      const { data } = await admin.storage.from(BUCKET).download(`${dir(date)}/${f.name}`);
      if (!data) return null;
      try { return JSON.parse(await data.text()); } catch { return null; }
    })
  );

  return NextResponse.json(records.filter(Boolean));
}

interface Bloqueio { motivo: string; mensagem: string }

/**
 * Valida as travas de presença do aluno. Retorna o primeiro bloqueio encontrado.
 * — aluno precisa estar vinculado a um núcleo ativo
 * — hoje precisa ser dia de treino do núcleo
 * — horário atual precisa estar dentro da janela do treino (± tolerância)
 * — GPS precisa estar dentro do raio do local do núcleo
 */
async function validarTravas(
  student: { nucleo?: string; lat?: number | null; lng?: number | null },
  brDate: Date,
  minutos: number,
): Promise<Bloqueio | null> {
  const nucleoNome = String(student.nucleo || '').trim();
  if (!nucleoNome || nucleoNome === 'Sem núcleo') {
    return {
      motivo: 'sem_nucleo',
      mensagem: 'Você ainda não está vinculado a um núcleo. Complete seu cadastro na aba Meus Dados para registrar presença.',
    };
  }

  const tenant = await findTenant(nucleoNome);
  if (!tenant) {
    return {
      motivo: 'nucleo_invalido',
      mensagem: `O núcleo "${nucleoNome}" não foi encontrado. Corrija seu núcleo na aba Meus Dados.`,
    };
  }

  const dias: string[] = Array.isArray(tenant.dias_treino) ? tenant.dias_treino : [];
  const semana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const diaHoje = semana[brDate.getDay()];
  if (dias.length === 0) {
    return {
      motivo: 'nucleo_sem_dias',
      mensagem: 'O admin do seu núcleo ainda não definiu os dias de treino. Presença bloqueada até a configuração.',
    };
  }
  if (!dias.includes(diaHoje)) {
    const rotulos: Record<string, string> = { segunda: 'Segunda', terca: 'Terça', quarta: 'Quarta', quinta: 'Quinta', sexta: 'Sexta', sabado: 'Sábado', domingo: 'Domingo' };
    const lista = dias.map(d => rotulos[d] || d).join(', ');
    return {
      motivo: 'fora_do_dia',
      mensagem: `Hoje não é dia de treino do seu núcleo (${lista}). A presença só pode ser registrada nos dias definidos pelo núcleo.`,
    };
  }

  // Janela de horário: minutos ≥ início − tol e < fim + tol
  const treino = extrairJanela(tenant, diaHoje);
  if (treino) {
    const minInicio = treino.inicio - TOLERANCIA_MIN;
    const maxFim = treino.fim + TOLERANCIA_MIN;
    if (minutos < minInicio || minutos >= maxFim) {
      const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
      return {
        motivo: 'fora_do_horario',
        mensagem: `Fora do horário de treino (${fmt(treino.inicio)} às ${fmt(treino.fim)}, tolerância de ${TOLERANCIA_MIN} min). Volte no horário para registrar sua presença.`,
      };
    }
  }

  // Distância: exige GPS do aluno e coordenadas do núcleo
  if (typeof tenant.lat === 'number' && typeof tenant.lng === 'number') {
    if (typeof student.lat !== 'number' || typeof student.lng !== 'number') {
      return {
        motivo: 'sem_gps',
        mensagem: 'Não foi possível obter sua localização. Ative o GPS do dispositivo e autorize o acesso para registrar presença.',
      };
    }
    const dist = distanciaMetros(student.lat, student.lng, tenant.lat as number, tenant.lng as number);
    const raio = RAIO_METROS;
    if (dist > raio) {
      return {
        motivo: 'fora_do_local',
        mensagem: `Você está a ~${Math.round(dist)}m do núcleo ${tenant.nome}. A presença só pode ser registrada dentro do local de treino (raio de ${raio}m).`,
      };
    }
  }

  return null;
}

/** Extrai {inicio, fim} em minutos do dia de treino do tenant. */
function extrairJanela(
  tenant: Record<string, unknown>,
  diaHoje: string,
): { inicio: number; fim: number } | null {
  const dias = tenant.dias_treino;
  if (!Array.isArray(dias)) return null;
  for (const d of dias) {
    // Formato objeto: {"dia":"segunda","inicio":"19:00","fim":"21:00"}
    if (d && typeof d === 'object') {
      const obj = d as { dia?: string; inicio?: string; fim?: string };
      if (obj.dia === diaHoje && obj.inicio && obj.fim) {
        const [h1, m1] = obj.inicio.split(':').map(Number);
        const [h2, m2] = obj.fim.split(':').map(Number);
        if (!isNaN(h1) && !isNaN(h2)) return { inicio: h1 * 60 + (m1 || 0), fim: h2 * 60 + (m2 || 0) };
      }
      continue;
    }
    // Formato string: "segunda 19:00-21:00" ou apenas "segunda"
    if (typeof d === 'string' && d.startsWith(diaHoje)) {
      const m = d.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
      if (m) {
        return { inicio: parseInt(m[1]) * 60 + parseInt(m[2]), fim: parseInt(m[3]) * 60 + parseInt(m[4]) };
      }
      return null; // dia bate mas sem horário definido → não trava por horário
    }
  }
  return null;
}

// POST /api/checkins  body: { student? }
// A identidade do aluno vem SEMPRE da sessão/ator resolvido no servidor —
// o corpo não escolhe quem marca presença. Alunos passam pelas travas
// (núcleo, dia, horário, GPS); responsável pode marcar em nome do tutelado
// (sem GPS do aluno, exige vínculo ativo). Admins do painel têm bypass com
// filtro de núcleo.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ator = await resolverAtor(req, body?.student?.id || null);
  if (!ator || !ator.studentId) {
    return NextResponse.json(
      { error: 'Não autenticado. Entre na sua conta para registrar presença.' },
      { status: 401 },
    );
  }

  // Dados do aluno SEMPRE do banco — nunca do corpo da requisição
  const { data: studentRow } = await admin
    .from('students')
    .select('id, nome_completo, graduacao, nucleo, foto_url, telefone, data_nascimento, menor_de_idade, assinatura_responsavel, nome_responsavel, cpf_responsavel')
    .eq('id', ator.studentId)
    .maybeSingle();
  if (!studentRow) {
    return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
  }
  type StudentCtx = {
    id: string; nome_completo: string; graduacao: string | null; nucleo?: string;
    foto_url: string | null; telefone: string | null; lat?: number | null; lng?: number | null;
    local_nome?: string | null; local_endereco?: string | null; local_map_url?: string | null;
  };
  const student = studentRow as unknown as StudentCtx & { nucleo: string | null };

  // ── CONFORMIDADE CADASTRAL (sem CPF/RG/termo não registra presença) ────────
  // Responsável respondendo pelo tutelado não é bloqueado pelo termo do menor
  // (a responsabilidade é dele), mas os documentos do aluno continuam exigidos.
  const gate = await exigirConformidadeAluno(req, String(student.id));
  if (!gate.ok && ator.emNomeDe !== 'responsavel') return gate.response;

  // ── SESSÃO DE ADMIN (bypass das travas, com filtro de núcleo) ──
  let adminNucleo: string | null = null; // null = sem admin; 'geral' = admin geral/owner
  let adminNucleos: string[] = [];
  let adminAcc: PanelAccount | undefined;
  const sess = readPanelSession(req);
  const credsAdmin = sess ? await loadCreds() : null;
  if (sess && credsAdmin) {
    const acc = credsAdmin[sess.u];
    if (acc) {
      adminAcc = acc;
      if (accIsGeral(acc)) {
        adminNucleo = 'geral';
      } else {
        adminNucleo = acc.nucleo;
        adminNucleos = accNucleos(acc);
      }
    }
  }
  if (adminAcc && adminNucleos.length > 0) {
    const nucleoNomeAluno = String(student?.nucleo || '').trim();
    const { data: tenants } = await admin
      .from('tenants')
      .select('slug, nome')
      .in('slug', adminNucleos);
    const nomesPorSlug: Record<string, string> = {};
    for (const t of tenants || []) {
      const nome = String((t as { nome?: string }).nome || '').trim();
      if (nome) nomesPorSlug[(t as { slug: string }).slug] = nome;
    }
    if (!accHasNucleo(adminAcc, nucleoNomeAluno, nomesPorSlug)) {
      return NextResponse.json(
        { success: false, bloqueado: true, motivo: 'fora_do_nucleo', error: 'Este aluno não é dos seus núcleos. Você só pode registrar presença de alunos dos núcleos que você gerencia.' },
        { status: 422 },
      );
    }
  }

  // Data/hora em horário de Brasília
  const now = new Date();
  const brDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const today = `${brDate.getFullYear()}-${String(brDate.getMonth()+1).padStart(2,'0')}-${String(brDate.getDate()).padStart(2,'0')}`;
  const hora = brDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const minutosAgora = brDate.getHours() * 60 + brDate.getMinutes();

  await ensureBucket();

  // ── TRAVAS DE PRESENÇA (somente alunos; admins têm bypass) ─────────────────
  const bloqueio = !adminNucleo ? await validarTravas(student, brDate, minutosAgora) : null;
  if (bloqueio) {
    await appendAudit({
      actor: student.id,
      actor_type: 'student',
      action: 'presenca_bloqueada',
      target_id: student.id,
      target_name: student.nome_completo,
      details: {
        nucleo: student.nucleo || null,
        motivo: bloqueio.motivo,
        data: today,
        hora,
      },
    });
    return NextResponse.json(
      { success: false, bloqueado: true, motivo: bloqueio.motivo, error: bloqueio.mensagem },
      { status: 422 },
    );
  }

  const { data: files } = await admin.storage.from(BUCKET).list(dir(today));
  if (files) {
    const names = new Set(files.map(f => f.name));
    const hasDeleted = names.has(`${student.id}.deleted`);
    const hasJson    = names.has(`${student.id}.json`);

    if (hasDeleted) {
      // Remove tombstone para permitir novo registro
      await admin.storage.from(BUCKET).remove([delKey(today, student.id)]);
    }
    if (hasJson && !hasDeleted) {
      return NextResponse.json({ success: false, alreadyRegistered: true });
    }
  }

  // Build Google Maps URL from GPS coords if no venue URL was provided
  // Travas garantem: quando lat/lng existem, são as do dispositivo do admin (frontend
  // envia as coordenadas do núcleo para aluno sem GPS). Sem coords = sem local.
  const lat = student.lat ?? null;
  const lng = student.lng ?? null;
  const fallbackMapUrl = (lat !== null && lng !== null)
    ? `https://maps.google.com/?q=${lat},${lng}`
    : null;

  const record = {
    student_id:     student.id,
    nome_completo:  student.nome_completo,
    graduacao:      student.graduacao || '',
    nucleo:         student.nucleo || 'Sem núcleo',
    foto_url:       student.foto_url || null,
    telefone:       student.telefone || '',
    hora,
    timestamp:      now.toISOString(),
    // Localização
    local_nome:     student.local_nome || null,
    local_endereco: student.local_endereco || null,
    local_map_url:  student.local_map_url || fallbackMapUrl,
    lat,
    lng,
  };

  const blob = new Blob([JSON.stringify(record)], { type: 'application/json' });
  const { error } = await admin.storage.from(BUCKET).upload(
    jsonKey(today, student.id), blob, { contentType: 'application/json', upsert: true }
  );

  if (error) {
    console.error('[checkins POST] upload error:', error);
    return NextResponse.json({ success: false, alreadyRegistered: false, error: error.message });
  }

  // Auditoria: registro de presença
  await appendAudit({
    actor: adminNucleo ? `admin:${sess?.u || ''}` : (ator.emNomeDe === 'responsavel' ? `resp:${ator.studentId}` : student.id as string),
    actor_type: adminNucleo ? 'admin' : 'student',
    action: 'presenca_registrada',
    target_id: student.id as string,
    target_name: student.nome_completo as string,
    details: {
      nucleo: student.nucleo || 'Sem núcleo',
      local: student.local_nome || null,
      coords_origem: (student.nucleo && typeof student.lat === 'number' && typeof student.lng === 'number') ? 'nucleo_do_aluno' : 'gps_dispositivo',
      hora,
      data: today,
      registrado_por: adminNucleo ? (sess?.u || 'admin') : (ator.emNomeDe === 'responsavel' ? 'responsavel' : 'proprio_aluno'),
      fora_do_dia_de_treino: false,
    },
  });

  return NextResponse.json({ success: true, alreadyRegistered: false, record });
}
