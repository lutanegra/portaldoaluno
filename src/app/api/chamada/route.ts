import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';
import {
  loadChamada, saveChamada, loadCheckinsBrutos, removerCheckinBruto, hojeBR, horaBR,
  type ChamadaEntry, type ChamadaStatus,
} from '@/lib/chamada';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

/** Sessão + núcleos permitidos. `geral` = owner/admin geral. */
async function contexto(req: Request) {
  const sess = readPanelSession(req);
  if (!sess) return null;
  const creds = await loadCreds();
  const acc = creds[sess.u];
  if (!acc) return null;
  const geral = accIsGeral(acc);
  const nucleos = geral ? [] : accNucleos(acc);
  return { sess, acc, geral, nucleos };
}

function bad(msg: string, code = 403) {
  return NextResponse.json({ error: msg }, { status: code });
}

// GET /api/chamada?data=YYYY-MM-DD&nucleo=slug
// Retorna alunos do núcleo (ordem alfabética), treinoExistente, chamada carregada
// (fundida com check-ins avulsos) e metadados do núcleo.
export async function GET(req: Request) {
  const ctx = await contexto(req);
  if (!ctx) return bad('Sessão administrativa necessária. Faça login novamente.', 401);

  const url = new URL(req.url);
  const data = url.searchParams.get('data') || hojeBR();
  const nucleoSlug = url.searchParams.get('nucleo') || ctx.acc.nucleo;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return bad('Data inválida.', 400);
  if (!/^[a-z0-9-]+$/i.test(nucleoSlug)) return bad('Núcleo inválido.', 400);

  // Permissão: geral vê tudo; admin de núcleo só os próprios núcleos
  if (!ctx.geral && !ctx.nucleos.includes(nucleoSlug)) {
    return bad('Este núcleo não está entre os que você gerencia.');
  }

  const { data: tenant, error: terr } = await supabase
    .from('tenants')
    .select('id, nome, slug, endereco, cidade, estado, dias_treino, lat, lng')
    .eq('slug', nucleoSlug)
    .maybeSingle();
  if (terr || !tenant) return bad('Núcleo não encontrado.', 404);

  const alunos = await alunosAtivosDoNucleo(nucleoSlug, tenant.nome);

  // Existe treino nessa data? (regra de dias de treino do núcleo)
  const dias: string[] = Array.isArray(tenant.dias_treino) ? tenant.dias_treino : [];
  const semana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const [y, m, d] = data.split('-').map(Number);
  const diaSemana = semana[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const treinoExistente = dias.length === 0 ? true : dias.includes(diaSemana);

  // Chamada salva + check-ins avulsos → estados iniciais
  const doc = await loadChamada(data, nucleoSlug);
  const brutos = await loadCheckinsBrutos(data);
  const entries: ChamadaEntry[] = [];
  const vistos = new Set<string>();
  if (doc) {
    for (const e of doc.entries) {
      if (!e?.id || !e.st) continue;
      entries.push({ ...e });
      vistos.add(e.id);
    }
  }
  // Pré-marca presentes com check-in avulso que a chamada ainda não registrou
  for (const [sid, info] of Object.entries(brutos)) {
    if (vistos.has(sid)) continue;
    // Confere que o aluno pertence a ESTE núcleo (check-in de outra data/núcleo não entra)
    if (!alunos.some(a => a.id === sid)) continue;
    entries.push({ id: sid, st: 'P', h: info.hora, src: 'checkin' });
  }

  return NextResponse.json({
    data,
    nucleo: { slug: nucleoSlug, nome: tenant.nome, endereco: tenant.endereco || '', cidade: tenant.cidade || '', estado: tenant.estado || '', lat: tenant.lat ?? null, lng: tenant.lng ?? null, dias_treino: dias },
    treinoExistente,
    diaSemana,
    alunos,
    entries,
    salvoEm: doc?.updated_at || null,
    salvoPor: doc?.updated_by || null,
    hoje: hojeBR(),
  });
}

async function alunosAtivosDoNucleo(nucleoSlug: string, nucleoNome: string) {
  const { data, error } = await supabase
    .from('students')
    .select('id, nome_completo, graduacao, nucleo, foto_url')
    .order('nome_completo', { ascending: true });
  if (error) return [];
  const nomeLower = nucleoNome.trim().toLowerCase();
  return (data as Array<Record<string, unknown>>)
    .filter(s => {
      const n = String(s.nucleo || '').trim().toLowerCase();
      return n === nucleoSlug.toLowerCase() || (nomeLower !== '' && n === nomeLower);
    });
}

// POST /api/chamada  body: { data, nucleo, entries: [{id, st}] }
// Salva a chamada completa (upsert, sem duplicar) e sincroniza check-ins avulsos.
export async function POST(req: Request) {
  const ctx = await contexto(req);
  if (!ctx) return bad('Sessão administrativa necessária. Faça login novamente.', 401);

  const body = await req.json().catch(() => null) as { data?: string; nucleo?: string; entries?: Array<{ id?: string; st?: string }> } | null;
  if (!body?.data || !body?.nucleo || !Array.isArray(body.entries)) return bad('Dados inválidos.', 400);
  const data = String(body.data);
  const nucleoSlug = String(body.nucleo);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return bad('Data inválida.', 400);
  if (!/^[a-z0-9-]+$/i.test(nucleoSlug)) return bad('Núcleo inválido.', 400);
  if (!ctx.geral && !ctx.nucleos.includes(nucleoSlug)) return bad('Este núcleo não está entre os que você gerencia.');

  const { data: tenant } = await supabase.from('tenants').select('nome, dias_treino').eq('slug', nucleoSlug).maybeSingle();
  if (!tenant) return bad('Núcleo não encontrado.', 404);

  // Regra: só registra chamada em dia de treino do núcleo
  const dias: string[] = Array.isArray(tenant.dias_treino) && tenant.dias_treino.length > 0 ? tenant.dias_treino : [];
  const semana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const [y, m, d] = data.split('-').map(Number);
  const diaSemana = semana[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  if (dias.length > 0 && !dias.includes(diaSemana)) {
    return bad(`Não existe treino do núcleo em ${data} (dias de treino: ${dias.join(', ')}). Chamada não registrada.`, 422);
  }

  // Estados válidos e alunos do núcleo
  const validos = new Set(['P', 'F', 'JU']);
  const alunos = await alunosAtivosDoNucleo(nucleoSlug, tenant.nome);
  const idsAlunos = new Set(alunos.map(a => a.id));
  const entries: ChamadaEntry[] = [];
  const nomePorId = new Map(alunos.map(a => [a.id, String(a.nome_completo || '')]));
  for (const e of body.entries) {
    const st = String(e?.st || '') as ChamadaStatus;
    if (!e?.id || !validos.has(st)) continue;
    if (!idsAlunos.has(String(e.id))) continue; // só alunos do próprio núcleo
    entries.push({ id: String(e.id), st, h: horaBR(), src: 'chamada', n: nomePorId.get(String(e.id)) || undefined });
  }
  // Dedup por aluno (garantia extra: nunca dois registros do mesmo aluno)
  const dedup = new Map<string, ChamadaEntry>();
  for (const e of entries) dedup.set(e.id, e);

  const doc = {
    data,
    nucleo: nucleoSlug,
    entries: Array.from(dedup.values()),
    updated_at: new Date().toISOString(),
    updated_by: ctx.sess.u,
  };
  await saveChamada(doc);

  // Sincroniza registros avulsos de check-in com a chamada salva:
  const brutos = await loadCheckinsBrutos(data);
  const operas: Promise<unknown>[] = [];
  for (const e of doc.entries) {
    if (e.st === 'P' && brutos[e.id]) continue; // presente + registro avulso existente: mantém (comprovante do aluno)
    if (e.st === 'F') operas.push(removerCheckinBruto(data, e.id)); // falta: apaga registro avulso
    if (e.st === 'JU' && brutos[e.id]) operas.push(removerCheckinBruto(data, e.id));
  }
  await Promise.all(operas);

  // Auditoria
  const { appendAudit } = await import('@/lib/audit');
  const P = doc.entries.filter(e => e.st === 'P').length;
  const F = doc.entries.filter(e => e.st === 'F').length;
  const JU = doc.entries.filter(e => e.st === 'JU').length;
  await appendAudit({
    actor: `admin:${ctx.sess.u}`,
    actor_type: 'admin',
    action: 'chamada_salva',
    target_id: `${nucleoSlug}@${data}`,
    target_name: tenant.nome,
    details: { data, nucleo: nucleoSlug, presentes: P, faltas: F, justificadas: JU, total: doc.entries.length, updated_at: doc.updated_at },
  });

  return NextResponse.json({ success: true, salvoEm: doc.updated_at, salvoPor: doc.updated_by, resumo: { presentes: P, faltas: F, justificadas: JU, total: doc.entries.length } });
}
