import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';
import { exigirConformidadeAluno } from '@/lib/alunoGate';
import { resolverAtor } from '@/lib/ator';
import { readAlunoSessionFromReq } from '@/lib/alunoSession';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const KEY = 'config/justificativas.json';

export type Justificativa = {
  id: string;
  student_id: string;
  student_name: string;
  nucleo: string;
  data_falta: string; // YYYY-MM-DD
  motivo: string;
  status: 'pendente' | 'aprovado' | 'recusado';
  resposta_mestre?: string;
  enviado_por?: 'proprio_aluno' | 'responsavel' | 'painel';
  conta_enviada_por?: string | null; // student_id da conta que autenticou o envio
  created_at: string;
  updated_at: string;
};

async function loadJustificativas(): Promise<Justificativa[]> {
  try {
    const { data: urlData } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(KEY, 30);
    if (!urlData?.signedUrl) return [];
    const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

async function saveJustificativas(list: Justificativa[]): Promise<void> {
  const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
  await supabaseAdmin.storage.from(BUCKET).upload(KEY, blob, { upsert: true });
}

// GET: student gets only THEIR justificativas (or a tutelado's); admin gets all or filtered by nucleo
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const student_id = searchParams.get('student_id');
  const nucleo = searchParams.get('nucleo');
  const admin = searchParams.get('admin') === 'true';

  const all = await loadJustificativas();

  if (admin) {
    // Admin de núcleo (sessão em cookie) é forçado aos próprios núcleos,
    // mesmo que peça outro valor na URL. Owner/Admin Geral veem tudo.
    const sess = readPanelSession(req);
    if (sess) {
      const creds = await loadCreds();
      const acc = creds[sess.u];
      if (acc && !accIsGeral(acc)) {
        const nucleosAdmin = accNucleos(acc);
        if (nucleosAdmin.length > 0) {
          const { data: tenants } = await supabaseAdmin.from('tenants').select('slug, nome').in('slug', nucleosAdmin);
          const permitidos = new Set<string>(nucleosAdmin.map(s => s.toLowerCase()));
          for (const t of tenants || []) {
            const nome = String((t as { nome?: string }).nome || '').trim().toLowerCase();
            if (nome) permitidos.add(nome);
          }
          return NextResponse.json(all.filter(j => permitidos.has(String(j.nucleo || '').trim().toLowerCase())));
        }
      }
    }
    const filtered = nucleo ? all.filter(j => j.nucleo === nucleo) : all;
    return NextResponse.json(filtered);
  }

  // Aluno/responsável: somente justificativas do próprio perfil ou de tutelado
  const ator = await resolverAtor(req, student_id);
  if (!ator) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  return NextResponse.json(all.filter(j => j.student_id === ator.studentId));
}

// POST: student submits a justificativa; admin approves/rejects
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action } = body;

  const all = await loadJustificativas();

  if (action === 'submit') {
    const { data_falta, motivo } = body;
    if (!data_falta || !motivo) {
      return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
    }

    // QUEM envia: só o próprio aluno, um responsável com vínculo ativo, ou o
    // painel. O backend registra a conta real — a troca de perfil no frontend
    // nunca falsifica o remetente.
    const ator = await resolverAtor(req, body.student_id);
    if (!ator || !ator.studentId) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    const student_id = ator.studentId;

    // Conformidade cadastral: sem CPF/RG (e termo, se menor) não há justificativa
    const gate = await exigirConformidadeAluno(req, student_id);
    if (!gate.ok && ator.emNomeDe !== 'responsavel') return gate.response;

    const { data: student } = await supabaseAdmin
      .from('students')
      .select('nome_completo, nucleo')
      .eq('id', student_id)
      .maybeSingle();
    if (!student) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

    // Validate date — must be within last 30 days
    const faltaDate = new Date(data_falta + 'T12:00:00');
    const now = new Date();
    const diffDays = (now.getTime() - faltaDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 0 || diffDays > 30) {
      return NextResponse.json({ error: 'A data deve estar nos últimos 30 dias.' }, { status: 400 });
    }

    // Check for duplicate (same student, same date)
    const existing = all.find(j => j.student_id === student_id && j.data_falta === data_falta);
    if (existing) {
      return NextResponse.json({ error: 'Já existe uma justificativa para esta data.' }, { status: 409 });
    }

    const now2 = new Date().toISOString();
    // Autoria real: a conta autenticada (nunca o frontend) determina quem enviou
    const sessaoAluno = readAlunoSessionFromReq(req);
    const justificativa: Justificativa = {
      id: `just_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      student_id,
      student_name: student.nome_completo,
      nucleo: student.nucleo,
      data_falta,
      motivo,
      status: 'pendente',
      enviado_por: ator.emNomeDe === 'responsavel' ? 'responsavel' : ator.viaPainel ? 'painel' : 'proprio_aluno',
      conta_enviada_por: sessaoAluno?.sid || null,
      created_at: now2,
      updated_at: now2,
    };

    all.push(justificativa);
    await saveJustificativas(all);
    return NextResponse.json({ success: true, justificativa });
  }

  if (action === 'review') {
    // Admin reviews (approve/reject)
    const { id, status, resposta_mestre } = body;
    if (!id || !['aprovado', 'recusado'].includes(status)) {
      return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 });
    }
    // Apenas painel autenticado pode aprovar/recusar
    const sess = readPanelSession(req);
    if (!sess) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });

    const idx = all.findIndex(j => j.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Justificativa não encontrada.' }, { status: 404 });

    all[idx] = {
      ...all[idx],
      status,
      resposta_mestre: resposta_mestre || '',
      updated_at: new Date().toISOString(),
    };
    await saveJustificativas(all);

    // Justificativa APROVADA converte a falta daquela data em FALTA JUSTIFICADA
    // na chamada do núcleo (mesmo aluno + mesma data; nunca afeta outra data).
    if (status === 'aprovado') {
      try {
        const { aplicarJustificada } = await import('@/lib/chamada');
        await aplicarJustificada(all[idx].student_id, all[idx].data_falta, all[idx].nucleo);
      } catch (e) {
        console.error('[justificativas] falha ao aplicar falta justificada:', e);
      }
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
