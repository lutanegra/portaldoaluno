import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { readPanelSession } from '@/lib/panelSession';
import { SESSION_COOKIE, verifyAlunoSession } from '@/lib/alunoSession';
import { isValidCPF, cpfDigits } from '@/lib/studentCompliance';
import { assinaturaPngDataUri } from '@/lib/assinatura';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const DOCS_DIR = 'docs/termos';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { data, error } = await admin
    .from('students')
    .select('id,nome_completo,cpf,data_nascimento,nome_pai,nome_mae,nucleo,nome_responsavel,cpf_responsavel,assinatura_responsavel,menor_de_idade')
    .eq('id', id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  // Assinatura registrada volta como imagem (para o documento impresso/PDF)
  const { data: doc } = await admin
    .from('termo_assinaturas')
    .select('assinatura_trajeto')
    .eq('student_id', id)
    .maybeSingle();
  const assinaturaPng = doc?.assinatura_trajeto
    ? assinaturaPngDataUri(doc.assinatura_trajeto)
    : null;

  return NextResponse.json({ ...data, assinatura_png: assinaturaPng });
}

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Fluxos permitidos: admin do painel, aluno logado ou o link público do
  // responsável (página /termo?id=..., enviada por WhatsApp) — comportamento
  // já existente do fluxo de assinatura remota. A validação de dados abaixo
  // garante a integridade em todos os casos.
  const ehAdmin = !!readPanelSession(req);
  let sessaoAluno: string | null = null;
  if (!ehAdmin) {
    const token = req.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    const sess = verifyAlunoSession(token); // sessão do aluno é opcional aqui (link público)
    sessaoAluno = sess?.sid || null;
  }

  const body = await req.json();
  const { nome_responsavel, cpf_responsavel, assinatura_trajeto } = body;

  // Conta de aluno autenticada: só pode assinar o termo do PRÓPRIO id ou de um
  // tutelado com vínculo ACTIVE (mesma regra do restante do app). Sem sessão,
  // vale o fluxo já existente do link público enviado ao responsável.
  if (sessaoAluno && !ehAdmin && id !== sessaoAluno) {
    const { podeAgirComo } = await import('@/lib/guardians');
    if (!(await podeAgirComo(sessaoAluno, id))) {
      return NextResponse.json({ error: 'Você não pode assinar o termo deste aluno.' }, { status: 403 });
    }
  }

  if (!nome_responsavel?.trim()) {
    return NextResponse.json({ error: 'Nome do responsável é obrigatório.' }, { status: 400 });
  }
  const cpfResp = cpfDigits(String(cpf_responsavel || ''));
  if (!cpfResp || !isValidCPF(cpfResp)) {
    return NextResponse.json({ error: 'CPF do responsável é obrigatório e precisa ser válido.' }, { status: 400 });
  }
  if (!assinatura_trajeto || String(assinatura_trajeto).length < 20) {
    return NextResponse.json({ error: 'A assinatura do responsável é obrigatória — desenhe no espaço indicado.' }, { status: 400 });
  }

  // Formata o CPF no padrão xxx.xxx.xxx-xx para consistência do documento
  const cpfFormatado = `${cpfResp.slice(0, 3)}.${cpfResp.slice(3, 6)}.${cpfResp.slice(6, 9)}-${cpfResp.slice(9)}`;

  const agora = new Date();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const agente = req.headers.get('user-agent') || '';

  // Evidências da assinatura eletrônica (JSON assinável, guarda-chuva do registro)
  const docId = `${id}-${agora.getTime()}`;
  const documento = {
    tipo: 'termo_responsabilidade_menor',
    student_id: id,
    assinado_por: {
      nome: String(nome_responsavel).trim(),
      cpf: cpfFormatado,
    },
    conta_autenticada: sessaoAluno,
    autenticacao: {
      ip,
      user_agent: agente.slice(0, 300),
      data_hora: agora.toISOString(),
    },
    assinatura: {
      tipo: 'eletronica_trajeto',
      trajeto: String(assinatura_trajeto).slice(0, 4000),
    },
  };
  const docJson = JSON.stringify(documento, null, 2);
  const docHash = crypto.createHash('sha256').update(docJson).digest('hex');
  const docPath = `${DOCS_DIR}/${id}/${docId}.json`;
  const blob = new Blob([docJson], { type: 'application/json' });
  const { error: upErr } = await admin.storage.from(BUCKET).upload(docPath, blob, { upsert: false });

  // Registro da assinatura (trajeto + evidências) para reproduzir no documento
  const { error: sigErr } = await admin
    .from('termo_assinaturas')
    .upsert({
      student_id: id,
      assinatura_trajeto: String(assinatura_trajeto).slice(0, 4000),
      assinado_por: String(nome_responsavel).trim(),
      assinatura_data: agora.toISOString(),
      doc_sha256: docHash,
      doc_armazenado_em: upErr ? null : docPath,
      ip,
      user_agent: agente.slice(0, 300),
    }, { onConflict: 'student_id' });

  if (sigErr) return NextResponse.json({ error: 'Não foi possível registrar a assinatura.' }, { status: 500 });

  const { error } = await admin
    .from('students')
    .update({
      nome_responsavel: String(nome_responsavel).trim(),
      cpf_responsavel: cpfFormatado,
      assinatura_responsavel: true,
    })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, assinatura_png: assinaturaPngDataUri(documento.assinatura.trajeto) });
}
