import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { readAlunoSessionFromReq } from '@/lib/alunoSession';
import { resolverAtor } from '@/lib/ator';
import { alunoEmConformidade, pendenciasAluno, resumoPendencias, isValidCPF, isValidRG, cpfDigits } from '@/lib/studentCompliance';
import { capitalizarNome } from '@/lib/nome';

export const dynamic = 'force-dynamic';

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build'
);

const BUCKET = 'photos';
const EXTRAS_KEY = 'extras/student-extras.json';
const AUTH_KEY = 'config/aluno-auth.json';

async function loadExtras(): Promise<Record<string, { apelido?: string; nome_social?: string; sexo?: string }>> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(EXTRAS_KEY, 30);
    if (!data?.signedUrl) return {};
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function loadAuthEmail(student_id: string): Promise<string | null> {
  try {
    const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(AUTH_KEY, 30);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl, { cache: 'no-store' });
    if (!res.ok) return null;
    const map = await res.json();
    return map[student_id]?.email || null;
  } catch { return null; }
}

// GET /api/aluno/dados?student_id=xxx
// Returns ONLY data the caller may see: the own profile, a tutelado with an
// active guardian link, or any student when called from the admin panel.
export async function GET(req: NextRequest) {
  const ator = await resolverAtor(req, req.nextUrl.searchParams.get('student_id'));
  if (!ator) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
  }
  const student_id = ator.studentId;

  if (!student_id) {
    return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
  }

  const { data: student, error } = await supabaseAdmin
    .from('students')
    .select('*')
    .eq('id', student_id)
    .maybeSingle();

  if (error || !student) {
    return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
  }

  // Merge student-extras (apelido, nome_social, sexo) — Storage is source of truth
  // Also merge auth map email — auth map is the authoritative source for login email
  const [extrasMap, authEmail] = await Promise.all([loadExtras(), loadAuthEmail(student_id)]);
  const ext = extrasMap[student_id];

  // Use non-empty string check so '' (unset) falls through to DB value
  const pick = (a: string | null | undefined, b: string | null | undefined) =>
    (a && a.trim()) ? a.trim() : ((b && (b as string).trim()) ? (b as string).trim() : null);

  const safeStudent = {
    ...student,
    apelido:     pick(ext?.apelido,     student.apelido     as string),
    nome_social: pick(ext?.nome_social, student.nome_social as string),
    sexo:        pick(ext?.sexo,        student.sexo        as string),
    // Auth map email takes priority as it's what the user set in their account
    email:       authEmail ?? student.email ?? null,
  };

  return NextResponse.json({ student: safeStudent });
}

// POST /api/aluno/dados — upload profile photo
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const student_id = formData.get('student_id') as string;
    const file = formData.get('foto') as File | null;

    if (!student_id || !file) {
      return NextResponse.json({ error: 'student_id e foto são obrigatórios.' }, { status: 400 });
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ error: 'Apenas imagens são aceitas.' }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'Imagem deve ter no máximo 5 MB.' }, { status: 400 });
    }

    const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg';
    const path = `fotos/${student_id}/perfil.${ext}`;
    const buf = await file.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, buf, { contentType: file.type, upsert: true });

    if (uploadError) {
      return NextResponse.json({ error: 'Erro ao fazer upload.' }, { status: 500 });
    }

    // Use a stable proxy URL — /api/foto always generates a fresh signed URL on demand
    const foto_url = `/api/foto?id=${encodeURIComponent(student_id)}`;

    // Update students table
    await supabaseAdmin.from('students').update({ foto_url }).eq('id', student_id);

    return NextResponse.json({ success: true, foto_url });
  } catch (err) {
    console.error('foto upload error:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}

// PATCH /api/aluno/dados
// Permite atualizar o próprio perfil, um tutelado com vínculo ativo (campos
// autorizados) ou qualquer aluno quando chamado pelo painel.
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const ator = await resolverAtor(req, body.student_id);
    if (!ator) {
      return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 });
    }
    const student_id = ator.studentId;
    const ehAdmin = ator.viaPainel;
    const emNomeDeResponsavel = ator.emNomeDe === 'responsavel' && !ator.viaPainel;
    const { ...updates } = body;

    if (!student_id) {
      return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
    }

    // Responsável acessando tutelado: campos de identidade/documentos são
    // restritos ao aluno adulto e ao painel (minimização de dados).
    // O responsável gerencia o cadastro COMPLETO do tutelado (núcleo, graduação,
    // documentos, endereço). A lista ALLOWED acima já exclui campos de sistema,
    // e o "vazio não apaga" abaixo protege dados existentes — não há mais
    // restrição adicional de campos para o responsável.

    // Verify student exists
    const { data: existing, error: fetchError } = await supabaseAdmin
      .from('students')
      .select('id, cpf, identidade, data_nascimento, menor_de_idade, assinatura_responsavel, nome_responsavel, cpf_responsavel')
      .eq('id', student_id)
      .maybeSingle();

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Aluno não encontrado.' }, { status: 404 });
    }

    // Allowed fields — students can only update their own profile data, not system fields
    const ALLOWED = [
      'nucleo', 'graduacao', 'tipo_graduacao',
      'cpf', 'identidade', 'numeracao_unica', 'data_nascimento',
      'telefone', 'email',
      'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado',
      'nome_pai', 'nome_mae', 'apelido', 'nome_social', 'sexo',
      'autoriza_imagem',
      'nome_responsavel', 'cpf_responsavel', 'foto_url',
      'desenvolvimento_atipico',
      // Ficha de Uniforme (medidas colhidas na solicitação; admin edita no painel)
      'uniforme_camisa_tamanho', 'uniforme_calca_altura', 'uniforme_calca_cintura',
      'uniforme_calca_gaviao', 'uniforme_camisa_grupo', 'uniforme_camisa_projeto',
    ];

    const BOOLEAN_FIELDS = new Set(['autoriza_imagem']);
    const payload: Record<string, unknown> = {};
    for (const key of ALLOWED) {
      if (key in updates) {
        if (BOOLEAN_FIELDS.has(key)) {
          payload[key] = !!updates[key];
        } else {
          payload[key] = updates[key] === '' ? null : updates[key];
        }
      }
    }

    // Nomes sempre gravados no padrão "Nome Sobrenome" (CAPSLOCK vira capitalização)
    for (const campoNome of ['nome_completo', 'nome_pai', 'nome_mae', 'nome_responsavel']) {
      if (typeof payload[campoNome] === 'string') {
        payload[campoNome] = capitalizarNome(payload[campoNome] as string);
      }
    }

    // Responsável no perfil do tutelado: o formulário envia o cadastro inteiro,
    // mas campos que chegaram vazios NÃO apagam o que o tutelado/admin já
    // preenchera (mesma semântica de "vazio não apaga" do próprio aluno).
    if (emNomeDeResponsavel) {
      for (const chave of Object.keys(payload)) {
        if (payload[chave] === null || payload[chave] === '') delete payload[chave];
      }
    }

    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'Nenhum campo válido para atualizar.' }, { status: 400 });
    }

    // Numeração Única duplicate check
    if (payload.numeracao_unica && typeof payload.numeracao_unica === 'string') {
      const nu = (payload.numeracao_unica as string).trim();
      if (nu) {
        const { data: nuConflict } = await supabaseAdmin
          .from('students')
          .select('id')
          .eq('numeracao_unica', nu)
          .neq('id', student_id)
          .maybeSingle();
        if (nuConflict) {
          return NextResponse.json({ error: 'Esta Numeração Única já está cadastrada para outro aluno.' }, { status: 409 });
        }
      }
    }

    // Email duplicate check
    if (payload.email && typeof payload.email === 'string') {
      const emailTrim = (payload.email as string).trim().toLowerCase();
      if (emailTrim && emailTrim.includes('@')) {
        const { data: emailConflict } = await supabaseAdmin
          .from('students')
          .select('id, nome_completo')
          .ilike('email', emailTrim)
          .neq('id', student_id)
          .maybeSingle();
        if (emailConflict) {
          return NextResponse.json({ error: `Este e-mail já está cadastrado para outro aluno: ${emailConflict.nome_completo}.` }, { status: 409 });
        }
      }
    }

    // CPF duplicate check — ensure no other student has the same CPF
    if (payload.cpf && typeof payload.cpf === 'string') {
      const cpfDigits = (payload.cpf as string).replace(/\D/g, '');
      if (cpfDigits.length === 11) {
        const { data: cpfConflict } = await supabaseAdmin
          .from('students')
          .select('id')
          .eq('cpf', payload.cpf as string)
          .neq('id', student_id)
          .maybeSingle();
        if (cpfConflict) {
          return NextResponse.json({ error: 'Este CPF já está cadastrado para outro aluno.' }, { status: 409 });
        }
      }
    }

    // Auto-compute menor_de_idade from data_nascimento if provided
    if (payload.data_nascimento) {
      const { idadeEm } = await import('@/lib/idade');
      const idade = idadeEm(String(payload.data_nascimento));
      payload.menor_de_idade = idade >= 0 ? idade < 18 : false;
    }

    // ── Regras de obrigatoriedade (RG/CPF e termo de menor) ─────────────────
    // O aluno sempre pode COMPLETAR o cadastro; porém não pode deixá-lo
    // irregular: campos obrigatórios não podem ser enviados vazios, valores
    // preenchidos precisam ser válidos e um aluno conforme não perde dados.
    const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());
    const novosDocs: Record<string, unknown> = { ...existing, ...(Object.fromEntries(Object.entries(payload).filter(([, v]) => !vazio(v)))) };
    const conflitos: string[] = [];

    // Formato dos documentos quando preenchidos
    if (!vazio(payload.cpf)) {
      const d = cpfDigits(String(payload.cpf));
      if (d.length !== 11 || !isValidCPF(d)) conflitos.push('CPF inválido — verifique os dígitos.');
    }
    if (!vazio(payload.identidade) && !isValidRG(String(payload.identidade))) {
      conflitos.push('RG inválido — verifique o número.');
    }

    // Obrigatoriedade no estado final
    if (vazio(novosDocs.cpf) || vazio(novosDocs.identidade)) {
      conflitos.push('CPF e RG são obrigatórios e não podem ficar em branco.');
    }
    const menorFinal = typeof novosDocs.menor_de_idade === 'boolean' ? novosDocs.menor_de_idade : undefined;
    const camposMenor = ['assinatura_responsavel', 'nome_responsavel', 'cpf_responsavel'];
    const mexeuEmMenor = camposMenor.some(k => k in payload);
    // O responsável pode (e precisa poder) preencher nome/CPF do responsável e
    // concluir o termo do tutelado — validar conformidade aqui criava um círculo
    // vicioso: o termo só seria válido se JÁ estivesse assinado. O painel e o
    // próprio aluno adulto continuam validados.
    // Menor com pendência APENAS do termo: pode preencher nome/CPF do
    // responsável — é o passo que precede a assinatura. Exigir conformidade
    // aqui criava o círculo "para assinar o termo precisa já ter assinado".
    // Painel e responsável atuando em tutelado também passam.
    const pendAtuais = pendenciasAluno(novosDocs as Parameters<typeof pendenciasAluno>[0], menorFinal);
    const pendSemTermo = pendAtuais.filter(p => p.campo !== 'termo');
    const preenchendoResponsavelDoMenor = !!(payload.nome_responsavel || payload.cpf_responsavel);
    if (mexeuEmMenor && !ehAdmin && !emNomeDeResponsavel &&
        !(pendSemTermo.length === 0 && pendAtuais.length > 0 && preenchendoResponsavelDoMenor)) {
      const simulado = {
        cpf: novosDocs.cpf as string | null,
        identidade: novosDocs.identidade as string | null,
        data_nascimento: (novosDocs.data_nascimento as string | null) ?? null,
        menor_de_idade: menorFinal,
        assinatura_responsavel: (novosDocs.assinatura_responsavel as boolean | null) ?? null,
        nome_responsavel: (novosDocs.nome_responsavel as string | null) ?? null,
        cpf_responsavel: (novosDocs.cpf_responsavel as string | null) ?? null,
      };
      if (!alunoEmConformidade(simulado, menorFinal)) {
        conflitos.push(`O cadastro ficaria irregular (${resumoPendencias(simulado, menorFinal)}). Termo, nome e CPF do responsável não podem ser removidos.`);
      }
    }
    if (conflitos.length > 0) {
      return NextResponse.json({ error: conflitos.join(' ') }, { status: 422 });
    }

    // Vincula ao núcleo pelo nome — tenants é a fonte da verdade e o nome vem do
    // dropdown alimentado pela tabela tenants, então só grava quando existe.
    if (payload.nucleo && typeof payload.nucleo === 'string') {
      const nome = payload.nucleo.trim();
      if (nome) {
        const { data: tenant } = await supabaseAdmin
          .from('tenants')
          .select('id')
          .ilike('nome', nome)
          .maybeSingle();
        payload.tenant_id = tenant?.id ?? null;
      } else {
        payload.tenant_id = null;
      }
    }

    const { error: updateError } = await supabaseAdmin
      .from('students')
      .update(payload)
      .eq('id', student_id);

    if (updateError) {
      console.error('aluno dados PATCH error:', updateError);
      return NextResponse.json({ error: 'Erro ao salvar dados.' }, { status: 500 });
    }

    // Also update extras (apelido, nome_social, sexo) in Storage if present
    const extrasFields = ['apelido', 'nome_social', 'sexo'];
    const extrasUpdate: Record<string, unknown> = {};
    for (const f of extrasFields) {
      if (f in payload) extrasUpdate[f] = payload[f];
    }
    if (Object.keys(extrasUpdate).length > 0) {
      try {
        const extrasMap = await loadExtras();
        extrasMap[student_id] = { ...extrasMap[student_id], ...extrasUpdate };
        const blob = new Blob([JSON.stringify(extrasMap, null, 2)], { type: 'application/json' });
        await supabaseAdmin.storage.from(BUCKET).upload(EXTRAS_KEY, blob, { upsert: true });
      } catch { /* non-critical */ }
    }

    // Fetch updated record to return
    const { data: updated } = await supabaseAdmin
      .from('students').select('*').eq('id', student_id).maybeSingle();

    return NextResponse.json({ success: true, student: updated });
  } catch (err) {
    console.error('aluno dados PATCH error:', err);
    return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
  }
}
