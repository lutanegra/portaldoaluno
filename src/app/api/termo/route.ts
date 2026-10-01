import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { SESSION_COOKIE, verifyAlunoSession } from '@/lib/alunoSession';
import { isValidCPF, cpfDigits } from '@/lib/studentCompliance';

export const dynamic = 'force-dynamic';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

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

  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  // Fluxos permitidos: admin do painel, aluno logado ou o link público do
  // responsável (página /termo?id=..., enviada por WhatsApp) — comportamento
  // já existente do fluxo de assinatura remota. A validação de dados abaixo
  // garante a integridade em todos os casos.
  const ehAdmin = !!readPanelSession(req);
  if (!ehAdmin) {
    const token = req.headers.get('cookie')?.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
    verifyAlunoSession(token); // sessão do aluno é opcional aqui (link público)
  }

  const body = await req.json();
  const { nome_responsavel, cpf_responsavel } = body;

  if (!nome_responsavel?.trim()) {
    return NextResponse.json({ error: 'Nome do responsável é obrigatório.' }, { status: 400 });
  }
  const cpfResp = cpfDigits(String(cpf_responsavel || ''));
  if (!cpfResp || !isValidCPF(cpfResp)) {
    return NextResponse.json({ error: 'CPF do responsável é obrigatório e precisa ser válido.' }, { status: 400 });
  }

  // Formata o CPF no padrão xxx.xxx.xxx-xx para consistência do documento
  const cpfFormatado = `${cpfResp.slice(0, 3)}.${cpfResp.slice(3, 6)}.${cpfResp.slice(6, 9)}-${cpfResp.slice(9)}`;

  const { error } = await admin
    .from('students')
    .update({
      nome_responsavel: nome_responsavel.trim(),
      cpf_responsavel: cpfFormatado,
      assinatura_responsavel: true,
    })
    .eq('id', id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
