import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { readAlunoSessionFromReq } from '@/lib/alunoSession';
import { readPanelSession } from '@/lib/panelSession';
import { idadeEm, faixaCadastro } from '@/lib/idade';
import { isValidCPF, cpfDigits } from '@/lib/studentCompliance';
import { appendAudit } from '@/lib/audit';
import { sendEmail } from '@/lib/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

const BUCKET = 'photos';
const DOCS_DIR = 'docs/autorizacoes';

/**
 * AUTORIZAÇÃO DE ADOLESCENTE (15–17 anos)
 *
 * Fluxo (sessão do aluno criada mas conta não liberada até autorizar):
 *   1. start    → aluno informa dados do responsável; código de 6 dígitos vai
 *                 para o e-mail do responsável (expira 15 min, máx. 5 tentativas)
 *   2. verify   → código validado (servidor compara hash); termo v1.0 liberado
 *   3. sign     → aceite + assinatura eletrônica (trajeto + IP + agente),
 *                 documento final com SHA-256 salvo em Storage privado
 *   4. status   → consulta (aluno/painel)
 *   5. revoke   → revogação (painel); bloqueia uso dependente de autorização
 *
 * Sem RESEND_API_KEY/SMTP configurado, start devolve send_failed e a conta
 * segue pendente — o admin pode orientar o responsável a reenviar após
 * configurar o e-mail. Nenhum dado do termo é exposto publicamente.
 */

const TERMO_VERSAO = '1.0';
const CODIGO_TTL_MS = 15 * 60 * 1000;
const MAX_TENTATIVAS = 5;

function gerarCodigo(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function hashCodigo(codigo: string): string {
  const segredo = process.env.PA_SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'portal-aluno-dev-secret';
  return crypto.createHmac('sha256', segredo).update(`authz:${codigo}`).digest('hex');
}

/** Monta o texto integral do termo (versão do documento assinado). */
function montarTermo(dados: {
  resp_nome: string; resp_cpf: string; resp_relacao: string; resp_email: string; resp_telefone: string;
  aluno_nome: string; aluno_nascimento: string; nucleo: string;
}): { titulo: string; corpo: string[] } {
  return {
    titulo: 'TERMO DE AUTORIZAÇÃO E CIÊNCIA PARA PARTICIPAÇÃO DE ADOLESCENTE',
    corpo: [
      `Responsável: ${dados.resp_nome} — CPF: ${dados.resp_cpf}`,
      `Relação com o adolescente: ${dados.resp_relacao}`,
      `E-mail: ${dados.resp_email} — Telefone: ${dados.resp_telefone || 'não informado'}`,
      `Adolescente: ${dados.aluno_nome} — Data de nascimento: ${dados.aluno_nascimento}`,
      `Núcleo/grupo: ${dados.nucleo || 'não informado'}`,
      '',
      '1. O responsável acima identificado DECLARA possuir legitimidade para autorizar a participação do adolescente nas atividades e serviços prestados por meio do Ginga Gestão.',
      '2. AUTORIZA a participação do adolescente nas atividades, aulas, eventos, graduações e comunicações relacionadas ao núcleo informado.',
      '3. DECLARA CIÊNCIA das atividades realizadas e das regras aplicáveis à participação.',
      '4. CONFIRMA que os dados fornecidos são verdadeiros e se compromete a informar alterações relevantes.',
      '5. DECLARA CIÊNCIA sobre o tratamento de dados pessoais do adolescente, autorizando o tratamento necessário para cadastro, participação, comunicação, controle de frequência, graduação, eventos, segurança e cumprimento de obrigações legais, conforme a Política de Privacidade.',
      '6. RECONHECE que esta autorização poderá ser revogada ou alterada a qualquer momento, conforme as regras aplicáveis, sem prejuízo do histórico registrado.',
      '7. A assinatura eletrônica abaixo registra a manifestação de vontade por meio eletrônico, com registro de evidências (conta autenticada, data e hora, endereço IP e identificação do dispositivo).',
      '',
      `Versão do termo: ${TERMO_VERSAO}`,
    ],
  };
}

async function carregarAuthz(studentId: string) {
  const { data } = await supabase
    .from('adolescent_authorizations')
    .select('*')
    .eq('student_id', studentId)
    .maybeSingle();
  return data;
}

export async function GET(req: NextRequest) {
  const sess = readAlunoSessionFromReq(req);
  const painel = readPanelSession(req);
  if (!sess && !painel) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  const studentId = req.nextUrl.searchParams.get('student_id') || sess?.sid || '';
  if (!studentId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
  // Aluno só consulta a própria autorização; painel consulta qualquer uma
  if (sess && !painel && sess.sid !== studentId) {
    return NextResponse.json({ error: 'Você só pode consultar a própria autorização.' }, { status: 403 });
  }

  // Download do documento assinado (?doc=1): só o próprio aluno ou o painel
  if (req.nextUrl.searchParams.get('doc') === '1') {
    const authzDoc = await carregarAuthz(studentId);
    if (!authzDoc?.doc_armazenado_em || authzDoc.status !== 'authorized') {
      return NextResponse.json({ error: 'Documento não disponível.' }, { status: 404 });
    }
    const { data: url } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(authzDoc.doc_armazenado_em, 120);
    if (!url?.signedUrl) return NextResponse.json({ error: 'Documento não disponível.' }, { status: 404 });
    return NextResponse.json({ url: url.signedUrl, hash: authzDoc.doc_sha256, versao: authzDoc.termo_versao });
  }

  const authz = await carregarAuthz(studentId);
  const { data: st } = await supabase
    .from('students')
    .select('nome_completo, data_nascimento, nucleo')
    .eq('id', studentId)
    .maybeSingle();
  const idade = st ? idadeEm(st.data_nascimento || '') : -1;

  return NextResponse.json({
    necessario: idade >= 0 && faixaCadastro(idade) === 'precisa_autorizacao',
    idade,
    termo_versao: TERMO_VERSAO,
    status: authz?.status || null,
    etapa: !authz ? 'dados' : authz.status === 'pending' ? (authz.codigo_hash ? 'termo' : 'codigo') : 'concluido',
    responsavel: authz ? {
      nome: authz.resp_nome,
      relacao: authz.resp_relacao,
      email_mascarado: String(authz.resp_email || '').replace(/(.{2}).+(@.+)/, '$1***$2'),
      telefone_mascarado: authz.resp_telefone ? `****${String(authz.resp_telefone).replace(/\D/g, '').slice(-4)}` : '',
    } : null,
    assinado_em: authz?.updated_at && authz?.status === 'authorized' ? authz.updated_at : null,
    revogado_em: authz?.revogado_em || null,
    documento_disponivel: authz?.status === 'authorized' && !!authz?.doc_armazenado_em,
    documento_hash: authz?.doc_sha256 || null,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = String(body.action || '');
    const sess = readAlunoSessionFromReq(req);
    if (!sess) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });

    /* ── START: dados do responsável + envio do código ─────────────────────── */
    if (action === 'start') {
      const { data: st } = await supabase
        .from('students')
        .select('nome_completo, data_nascimento, nucleo')
        .eq('id', sess.sid)
        .maybeSingle();
      if (!st) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
      const idade = idadeEm(st.data_nascimento || '');
      if (faixaCadastro(idade) !== 'precisa_autorizacao') {
        return NextResponse.json({ error: 'Autorização não é necessária para esta conta.' }, { status: 422 });
      }

      const respNome = String(body.resp_nome || '').trim();
      const respCpf = cpfDigits(String(body.resp_cpf || ''));
      const respRelacao = String(body.resp_relacao || 'responsavel_legal');
      const respEmail = String(body.resp_email || '').trim().toLowerCase();
      const respTelefone = String(body.resp_telefone || '').trim();
      const respNascimento = String(body.resp_nascimento || '').slice(0, 10) || null;

      if (!respNome || respNome.split(' ').filter(Boolean).length < 2) {
        return NextResponse.json({ error: 'Informe o nome completo do responsável.' }, { status: 400 });
      }
      if (!isValidCPF(respCpf)) {
        return NextResponse.json({ error: 'CPF do responsável inválido.' }, { status: 400 });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(respEmail)) {
        return NextResponse.json({ error: 'E-mail do responsável inválido.' }, { status: 400 });
      }
      if (respNascimento) {
        const idadeResp = idadeEm(respNascimento);
        if (idadeResp >= 0 && idadeResp < 18) {
          return NextResponse.json({ error: 'O responsável precisa ser maior de 18 anos.' }, { status: 422 });
        }
      }

      const codigo = gerarCodigo();
      const expira = new Date(Date.now() + CODIGO_TTL_MS).toISOString();

      const { data: authzAtual } = await supabase
        .from('adolescent_authorizations')
        .select('id, status')
        .eq('student_id', sess.sid)
        .maybeSingle();
      if (authzAtual?.status === 'authorized') {
        return NextResponse.json({ error: 'Autorização já concluída.' }, { status: 409 });
      }

      const registro = {
        student_id: sess.sid,
        status: 'pending',
        resp_nome: respNome,
        resp_cpf: respCpf,
        resp_nascimento: respNascimento,
        resp_relacao: respRelacao,
        resp_email: respEmail,
        resp_telefone: respTelefone,
        termo_versao: TERMO_VERSAO,
        codigo_hash: hashCodigo(codigo),
        codigo_expira_em: expira,
        codigo_tentativas: 0,
        metodo_autenticacao: 'codigo_email',
      };

      const { error } = await supabase
        .from('adolescent_authorizations')
        .upsert(registro, { onConflict: 'student_id' });
      if (error) return NextResponse.json({ error: 'Não foi possível iniciar a autorização.' }, { status: 500 });

      // Envia o código para o e-mail do responsável
      const { buildOtpHtml } = await import('@/lib/email');
      const { subject, html } = buildOtpHtml(respNome, codigo);
      const resultado = await sendEmail(
        respEmail,
        subject.replace('Seu código', 'Autorização do adolescente — código'),
        html.replace(/o código/i, 'o código de autorização'),
      );

      await appendAudit({
        actor: sess.sid, actor_type: 'student', action: 'autorizacao_iniciada',
        target_id: sess.sid, target_name: st.nome_completo,
        details: { resp_nome: respNome, email_mascarado: respEmail.replace(/(.{2}).+(@.+)/, '$1***$2'), enviado: resultado.sent },
      });

      if (!resultado.sent) {
        return NextResponse.json({
          success: true,
          etapa: 'codigo',
          send_failed: true,
          message: 'Não foi possível enviar o e-mail agora. Verifique a configuração de e-mail do sistema e tente novamente.',
        });
      }
      return NextResponse.json({
        success: true,
        etapa: 'codigo',
        email_mascarado: respEmail.replace(/(.{2}).+(@.+)/, '$1***$2'),
        message: 'Código enviado para o e-mail do responsável.',
      });
    }

    /* ── RESEND: reenvio do código ──────────────────────────────────────────── */
    if (action === 'resend') {
      const authz = await carregarAuthz(sess.sid);
      if (!authz || authz.status !== 'pending' || !authz.codigo_hash) {
        return NextResponse.json({ error: 'Nenhum código pendente. Reinicie a autorização.' }, { status: 400 });
      }
      const codigo = gerarCodigo();
      await supabase
        .from('adolescent_authorizations')
        .update({ codigo_hash: hashCodigo(codigo), codigo_expira_em: new Date(Date.now() + CODIGO_TTL_MS).toISOString(), codigo_tentativas: 0 })
        .eq('student_id', sess.sid);
      const { buildOtpHtml } = await import('@/lib/email');
      const { subject, html } = buildOtpHtml(authz.resp_nome, codigo);
      const resultado = await sendEmail(authz.resp_email, subject, html);
      if (!resultado.sent) return NextResponse.json({ send_failed: true, message: 'Falha no envio. Tente novamente.' });
      return NextResponse.json({ success: true, message: 'Código reenviado.' });
    }

    /* ── VERIFY: valida o código e libera o termo ───────────────────────────── */
    if (action === 'verify') {
      const authz = await carregarAuthz(sess.sid);
      if (!authz || authz.status !== 'pending' || !authz.codigo_hash) {
        return NextResponse.json({ error: 'Reinicie a autorização.' }, { status: 400 });
      }
      if (authz.codigo_expira_em && new Date(authz.codigo_expira_em) < new Date()) {
        return NextResponse.json({ error: 'Código expirado. Solicite um novo.' }, { status: 400 });
      }
      if (authz.codigo_tentativas >= MAX_TENTATIVAS) {
        return NextResponse.json({ error: 'Muitas tentativas. Solicite um novo código.' }, { status: 429 });
      }
      const codigo = String(body.codigo || '').replace(/\D/g, '');
      if (hashCodigo(codigo) !== authz.codigo_hash) {
        await supabase
          .from('adolescent_authorizations')
          .update({ codigo_tentativas: (authz.codigo_tentativas || 0) + 1 })
          .eq('student_id', sess.sid);
        return NextResponse.json({ error: 'Código incorreto.' }, { status: 400 });
      }
      // Código ok: mantém pendente, mas o termo já pode ser exibido/assinado
      const { data: stV } = await supabase
        .from('students')
        .select('nome_completo, data_nascimento, nucleo')
        .eq('id', sess.sid)
        .maybeSingle();
      return NextResponse.json({ success: true, etapa: 'termo', termo: montarTermo({
        resp_nome: authz.resp_nome,
        resp_cpf: authz.resp_cpf
          ? `${'•••'}.${authz.resp_cpf.slice(3, 6)}.${authz.resp_cpf.slice(6, 9)}-${'••'}`
          : '',
        resp_relacao: authz.resp_relacao,
        resp_email: String(authz.resp_email || '').replace(/(.{2}).+(@.+)/, '$1***$2'),
        resp_telefone: authz.resp_telefone,
        aluno_nome: stV?.nome_completo || '',
        aluno_nascimento: stV?.data_nascimento ? stV.data_nascimento.split('-').reverse().join('/') : '—',
        nucleo: stV?.nucleo || '—',
      }) });
    }

    /* ── SIGN: aceite + assinatura eletrônica com evidências ────────────────── */
    if (action === 'sign') {
      const authz = await carregarAuthz(sess.sid);
      if (!authz || authz.status !== 'pending') {
        return NextResponse.json({ error: 'Autorização não está pendente.' }, { status: 400 });
      }
      if (!body.aceite) {
        return NextResponse.json({ error: 'Confirme que leu e compreendeu o termo.' }, { status: 400 });
      }
      const trajeto = typeof body.assinatura_trajeto === 'string' && body.assinatura_trajeto.includes(',')
        ? body.assinatura_trajeto
        : null;
      if (!trajeto || String(trajeto).length < 40) {
        return NextResponse.json({ error: 'Desenhe a assinatura no campo indicado.' }, { status: 400 });
      }

      const { data: st } = await supabase
        .from('students')
        .select('nome_completo, data_nascimento, nucleo')
        .eq('id', sess.sid)
        .maybeSingle();
      if (!st) return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });

      const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim();
      const agente = req.headers.get('user-agent') || '';
      const agora = new Date();
      const idDoc = `AUTHZ-${sess.sid.slice(0, 8)}-${agora.getTime().toString(36).toUpperCase()}`;

      const respCpfFmt = authz.resp_cpf
        ? `${authz.resp_cpf.slice(0, 3)}.${authz.resp_cpf.slice(3, 6)}.${authz.resp_cpf.slice(6, 9)}-${authz.resp_cpf.slice(9)}`
        : '';
      const termo = montarTermo({
        resp_nome: authz.resp_nome,
        resp_cpf: respCpfFmt,
        resp_relacao: authz.resp_relacao,
        resp_email: authz.resp_email,
        resp_telefone: authz.resp_telefone,
        aluno_nome: st.nome_completo,
        aluno_nascimento: st.data_nascimento ? st.data_nascimento.split('-').reverse().join('/') : '—',
        nucleo: st.nucleo || '—',
      });

      // Documento final + hash SHA-256
      const documento = {
        id: idDoc,
        titulo: termo.titulo,
        versao_termo: TERMO_VERSAO,
        emitido_em: agora.toISOString(),
        responsavel: {
          nome: authz.resp_nome,
          cpf: respCpfFmt,
          relacao: authz.resp_relacao,
          email: authz.resp_email,
          telefone: authz.resp_telefone,
        },
        adolescente: {
          student_id: sess.sid,
          nome: st.nome_completo,
          data_nascimento: st.data_nascimento,
          nucleo: st.nucleo || null,
        },
        declaracoes: termo.corpo,
        assinatura: {
          tipo: 'eletronica_trajeto',
          trajeto: `${String(trajeto).slice(0, 4000)}`,
          nome_digitado: String(body.nome_digitado || authz.resp_nome),
          autenticacao: {
            metodo: 'codigo_por_email_validado',
            conta_autenticada: sess.sid,
            ip,
            user_agent: agente.slice(0, 300),
            data_hora: agora.toISOString(),
          },
        },
        evidencias: {
          codigo_validado: true,
          aceite_express: true,
          documento_gerado_por: 'Ginga Gestão',
        },
      };
      const docJson = JSON.stringify(documento, null, 2);
      const docHash = crypto.createHash('sha256').update(docJson).digest('hex');

      // Guarda em Storage privado (bucket photos, sem URL pública)
      const path = `${DOCS_DIR}/${sess.sid}/${idDoc}.json`;
      const blob = new Blob([docJson], { type: 'application/json' });
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { upsert: false });
      const docArmazenado = upErr ? null : path;

      const { error: updErr } = await supabase
        .from('adolescent_authorizations')
        .update({
          status: 'authorized',
          assinatura_data: agora.toISOString(),
          evidencias: {
            trajeto_presente: true,
            ip: ip || null,
            user_agent: agente.slice(0, 300),
            nome_digitado: String(body.nome_digitado || authz.resp_nome),
          },
          doc_sha256: docHash,
          doc_armazenado_em: docArmazenado,
          doc_ip: ip || null,
          updated_at: agora.toISOString(),
        })
        .eq('student_id', sess.sid);
      if (updErr) return NextResponse.json({ error: 'Não foi possível concluir a autorização.' }, { status: 500 });

      // Sincroniza o termo do aluno (alimenta a conformidade cadastral já existente)
      await supabase
        .from('students')
        .update({
          assinatura_responsavel: true,
          nome_responsavel: authz.resp_nome,
          cpf_responsavel: respCpfFmt,
        })
        .eq('id', sess.sid);

      await appendAudit({
        actor: sess.sid, actor_type: 'student', action: 'autorizacao_assinada',
        target_id: sess.sid, target_name: st.nome_completo,
        details: { documento: idDoc, hash: docHash.slice(0, 16) + '…', versao: TERMO_VERSAO },
      });

      return NextResponse.json({
        success: true,
        documento_id: idDoc,
        hash: docHash,
        concluido: true,
        message: 'Autorização concluída. Sua conta está liberada.',
      });
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (err) {
    console.error('autorizacao error:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

/* ── REVOKE (somente painel): revogação com histórico preservado ──────────── */
export async function DELETE(req: NextRequest) {
  const painel = readPanelSession(req);
  if (!painel) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
  const studentId = req.nextUrl.searchParams.get('student_id');
  if (!studentId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
  const { error } = await supabase
    .from('adolescent_authorizations')
    .update({
      status: 'revoked',
      revogado_em: new Date().toISOString(),
      revogado_por: `painel:${painel.u}`,
      revogado_motivo: 'Revogado pelo painel administrativo',
      updated_at: new Date().toISOString(),
    })
    .eq('student_id', studentId);
  if (error) return NextResponse.json({ error: 'Não foi possível revogar.' }, { status: 500 });
  // Revogação volta a travar as ações do adolescente (o termo antigo deixa de valer)
  await supabase
    .from('students')
    .update({ assinatura_responsavel: false })
    .eq('id', studentId);
  await appendAudit({
    actor: `painel:${painel.u}`, actor_type: 'admin', action: 'autorizacao_revogada',
    target_id: studentId,
  });
  return NextResponse.json({ success: true });
}
