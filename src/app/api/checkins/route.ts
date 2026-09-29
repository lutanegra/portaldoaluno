import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { appendAudit } from '@/lib/audit';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const dir = (date: string) => `checkins/${date}`;
const jsonKey = (date: string, sid: string) => `checkins/${date}/${sid}.json`;
const delKey  = (date: string, sid: string) => `checkins/${date}/${sid}.deleted`;

async function ensureBucket() {
  const { data: buckets } = await admin.storage.listBuckets();
  if (!buckets?.some(b => b.name === BUCKET)) {
    await admin.storage.createBucket(BUCKET, { public: false });
  }
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

// POST /api/checkins  body: { student }
export async function POST(req: Request) {
  const { student } = await req.json();

  // Data/hora em horário de Brasília
  const now = new Date();
  const brDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const today = `${brDate.getFullYear()}-${String(brDate.getMonth()+1).padStart(2,'0')}-${String(brDate.getDate()).padStart(2,'0')}`;
  const hora = brDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  await ensureBucket();

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

  // ── Validação do dia de treino do núcleo ──────────────────────────────────
  // Registra em qualquer dia (aviso só na UI), mas sinaliza quando o aluno
  // registra fora dos dias de treino definidos no núcleo dele.
  let foraDoDiaTreino = false;
  try {
    const nomeNucleo = String(student.nucleo || '').trim();
    if (nomeNucleo && nomeNucleo !== 'Sem núcleo') {
      const { data: tenantRow } = await admin
        .from('tenants')
        .select('slug, dias_treino')
        .or(`nome.eq.${nomeNucleo},slug.eq.${nomeNucleo}`)
        .maybeSingle();
      const dias: string[] = Array.isArray(tenantRow?.dias_treino) ? tenantRow.dias_treino : [];
      if (dias.length > 0) {
        const semana = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
        const diaHoje = semana[brDate.getDay()];
        foraDoDiaTreino = !dias.includes(diaHoje);
      }
    }
  } catch { /* validação é best-effort; nunca bloqueia o registro */ }

  // Build fallback Google Maps URL from GPS coords if no venue URL was provided
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

  // Auditoria: registro de presença (inclui flag de dia fora do treino)
  await appendAudit({
    actor: student.id,
    actor_type: 'student',
    action: foraDoDiaTreino ? 'presenca_fora_do_dia' : 'presenca_registrada',
    target_id: student.id,
    target_name: student.nome_completo,
    details: {
      nucleo: student.nucleo || 'Sem núcleo',
      local: student.local_nome || null,
      hora,
      data: today,
      fora_do_dia_de_treino: foraDoDiaTreino,
    },
  });

  return NextResponse.json({ success: true, alreadyRegistered: false, fora_do_dia: foraDoDiaTreino, record });
}
