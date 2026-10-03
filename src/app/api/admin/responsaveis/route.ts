import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { readPanelSession } from '@/lib/panelSession';
import { loadCreds, accIsGeral, accNucleos } from '@/lib/panelCredentials';
import { appendAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

/**
 * GESTÃO DE RESPONSÁVEIS E AUTORIZAÇÕES — somente painel.
 *
 * GET: lista perfis de responsável + vínculos + autorizações (para a aba
 *      Contas Alunos do painel).
 * POST: aprovar/recusar vínculo pendente · revogar vínculo · criar vínculo
 *       direto (via painel nasce ativo) · revogar autorização de adolescente.
 *
 * Admin de núcleo: vê e age apenas dentro dos próprios núcleos.
 */

async function nucleosDoAdmin(req: NextRequest): Promise<string[] | 'geral' | null> {
  const sess = readPanelSession(req);
  if (!sess) return null;
  const creds = await loadCreds();
  const acc = creds[sess.u];
  if (!acc) return null;
  if (accIsGeral(acc)) return 'geral';
  const slugs = accNucleos(acc);
  if (slugs.length === 0) return [];
  const { data: tenants } = await supabase
    .from('tenants')
    .select('nome')
    .in('slug', slugs);
  return [...slugs, ...(tenants || []).map((t: { nome?: string }) => t.nome || '').filter(Boolean)];
}

function alunoDentroDosNucleos(
  aluno: { nucleo?: string | null; tenant_slug?: string | null },
  nucleos: string[],
): boolean {
  const alvo = String(aluno.nucleo || '').trim().toLowerCase();
  const slug = String((aluno as { tenant_slug?: string }).tenant_slug || '').trim().toLowerCase();
  const set = new Set(nucleos.map(n => n.trim().toLowerCase()));
  return set.has(alvo) || (!!slug && set.has(slug));
}

export async function GET(req: NextRequest) {
  const nucleos = await nucleosDoAdmin(req);
  if (nucleos === null) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });

  const [guardians, links, authzs] = await Promise.all([
    supabase.from('guardians').select('*'),
    supabase.from('guardian_links').select('*').order('created_at', { ascending: false }),
    supabase.from('adolescent_authorizations').select('*').order('updated_at', { ascending: false }),
  ]);

  // Contas de responsável (students.conta_tipo) — gestão na aba dedicada
  const { data: contasResp } = await supabase
    .from('students')
    .select('id, nome_completo, nucleo, foto_url, conta_tipo, ordem_inscricao, telefone, email, created_at')
    .in('conta_tipo', ['responsavel', 'responsavel_aluno'])
    .is('deleted_at', null)
    .order('nome_completo', { ascending: true });

  // Acesso (mapa de contas do app) e dependentes por responsável
  const acessoPorConta = new Map<string, { username: string; email: string }>();
  try {
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrl('config/aluno-auth.json', 30);
    if (urlData?.signedUrl) {
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (res.ok) {
        const map = (await res.json()) as Record<string, { student_id?: string; username?: string; email?: string }>;
        for (const a of Object.values(map)) {
          if (a.student_id) acessoPorConta.set(a.student_id, { username: a.username || '', email: a.email || '' });
        }
      }
    }
  } catch { /* sem mapa de contas */ }

  const guardiansSet = new Set((guardians.data || []).map(g => g.student_id));

  // Enriquece com dados seguros dos alunos envolvidos
  const ids = new Set<string>();
  for (const g of guardians.data || []) ids.add(g.student_id);
  for (const l of links.data || []) { ids.add(l.guardian_student_id); ids.add(l.student_id); }
  for (const a of authzs.data || []) ids.add(a.student_id);
  let alunosMap = new Map<string, { id: string; nome_completo: string; nucleo: string | null; foto_url: string | null; conta_tipo: string | null }>();
  if (ids.size > 0) {
    const { data: alunos } = await supabase
      .from('students')
      .select('id, nome_completo, nucleo, foto_url, conta_tipo')
      .in('id', [...ids]);
    alunosMap = new Map((alunos || []).map(a => [a.id, a]));
  }

  // Visibilidade: aluno dentro dos núcleos do admin; conta só-responsável
  // (sem núcleo próprio) aparece quando algum tutelado vinculado está no núcleo.
  const alunosVisiveis = new Set<string>();
  for (const a of alunosMap.values()) {
    if (nucleos === 'geral' || alunoDentroDosNucleos(a, nucleos)) alunosVisiveis.add(a.id);
  }
  const responsaveisVisiveis = new Set<string>();
  if (nucleos !== 'geral') {
    for (const l of links.data || []) {
      if (alunosVisiveis.has(l.student_id)) responsaveisVisiveis.add(l.guardian_student_id);
    }
  }

  const visivel = (sid: string) => {
    if (nucleos === 'geral') return true;
    return alunosVisiveis.has(sid) || responsaveisVisiveis.has(sid);
  };

  // Dependentes por responsável (usa o mapa de alunos já carregado)
  const dependentesPorGuardian = new Map<string, { id: string; nome: string; status: string }[]>();
  for (const l of links.data || []) {
    const arr = dependentesPorGuardian.get(l.guardian_student_id) || [];
    arr.push({ id: l.student_id, nome: alunosMap.get(l.student_id)?.nome_completo || '—', status: l.status });
    dependentesPorGuardian.set(l.guardian_student_id, arr);
  }

  // Enriquecimento adicional para a lista de contas de responsável
  const idsExtra = (contasResp || []).filter(c => !ids.has(c.id));
  for (const c of idsExtra) ids.add(c.id);
  if (idsExtra.length > 0) {
    const { data: alunosExtra } = await supabase
      .from('students')
      .select('id, nome_completo, nucleo, foto_url, conta_tipo')
      .in('id', idsExtra.map(c => c.id));
    for (const a of alunosExtra || []) alunosMap.set(a.id, a);
  }

  return NextResponse.json({
    contas: (contasResp || [])
      .filter(c => nucleos === 'geral' || responsaveisVisiveis.has(c.id) || alunosVisiveis.has(c.id))
      .map(c => {
        const deps = dependentesPorGuardian.get(c.id) || [];
        const acesso = acessoPorConta.get(c.id) || null;
        return {
          student_id: c.id,
          nome: c.nome_completo,
          nucleo: c.nucleo || null,
          foto_url: c.foto_url || null,
          conta_tipo: c.conta_tipo,
          tem_matricula: c.ordem_inscricao != null,
          matricula: c.ordem_inscricao != null ? String(c.ordem_inscricao).padStart(3, '0') : null,
          tem_acesso: !!acesso,
          acesso_username: acesso?.username || null,
          acesso_email: acesso?.email || null,
          telefone: c.telefone || null,
          email: c.email || null,
          eh_perfil_responsavel: guardiansSet.has(c.id),
          dependentes: deps.map(d => ({ id: d.id, nome: d.nome, status: d.status })),
          criado_em: c.created_at,
        };
      }),
    perfis: (guardians.data || [])
      .filter(g => visivel(g.student_id))
      .map(g => {
        const a = alunosMap.get(g.student_id);
        return {
          student_id: g.student_id,
          nome: a?.nome_completo || '—',
          nucleo: a?.nucleo || null,
          foto_url: a?.foto_url || null,
          conta_tipo: (a as { conta_tipo?: string | null })?.conta_tipo || null,
          cpf_mascarado: g.cpf_digits ? `•••.${g.cpf_digits.slice(3, 6)}.${g.cpf_digits.slice(6, 9)}-••` : '—',
          criado_em: g.criado_em,
        };
      }),
    vinculos: (links.data || [])
      .filter(l => visivel(l.guardian_student_id) || visivel(l.student_id))
      .map(l => ({
        id: l.id,
        guardian_student_id: l.guardian_student_id,
        guardian_nome: alunosMap.get(l.guardian_student_id)?.nome_completo || '—',
        student_id: l.student_id,
        student_nome: alunosMap.get(l.student_id)?.nome_completo || '—',
        student_nucleo: alunosMap.get(l.student_id)?.nucleo || null,
        relacao: l.relacao,
        status: l.status,
        criado_em: l.created_at,
        revogado_em: l.revogado_em,
        revogado_por: l.revogado_por,
      })),
    autorizacoes: (authzs.data || [])
      .filter(a => visivel(a.student_id))
      .map(a => {
        const st = alunosMap.get(a.student_id);
        return {
          student_id: a.student_id,
          student_nome: st?.nome_completo || '—',
          student_nucleo: st?.nucleo || null,
          status: a.status,
          resp_nome: a.resp_nome,
          resp_relacao: a.resp_relacao,
          resp_email_mascarado: String(a.resp_email || '').replace(/(.{2}).+(@.+)/, '$1***$2'),
          termo_versao: a.termo_versao,
          assinado_em: a.assinatura_data || null,
          revogado_em: a.revogado_em,
          doc_hash: a.doc_sha256,
          tem_documento: !!a.doc_armazenado_em,
        };
      }),
  });
}

export async function POST(req: NextRequest) {
  const sess = readPanelSession(req);
  if (!sess) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });
  const nucleos = await nucleosDoAdmin(req);
  if (nucleos === null) return NextResponse.json({ error: 'Sessão administrativa necessária.' }, { status: 401 });

  const body = await req.json();
  const action = String(body.action || '');
  const alunoVisivel = async (sid: string) => {
    if (nucleos === 'geral') return true;
    const { data: a } = await supabase.from('students').select('nucleo').eq('id', sid).maybeSingle();
    return a ? alunoDentroDosNucleos(a as { nucleo?: string | null }, nucleos) : false;
  };

  /* ── Vínculos ────────────────────────────────────────────────────────────── */
  if (action === 'link-approve' || action === 'link-reject') {
    const linkId = String(body.link_id || '');
    const { data: link } = await supabase.from('guardian_links').select('*').eq('id', linkId).maybeSingle();
    if (!link) return NextResponse.json({ error: 'Vínculo não encontrado.' }, { status: 404 });
    if (!(await alunoVisivel(link.student_id))) {
      return NextResponse.json({ error: 'Aluno fora dos seus núcleos.' }, { status: 403 });
    }
    const novoStatus = action === 'link-approve' ? 'active' : 'rejected';
    const { error } = await supabase
      .from('guardian_links')
      .update({ status: novoStatus, aprovado_em: novoStatus === 'active' ? new Date().toISOString() : null, updated_at: new Date().toISOString() })
      .eq('id', linkId);
    if (error) return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 });
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin',
      action: novoStatus === 'active' ? 'vinculo_aprovado' : 'vinculo_rejeitado',
      target_id: link.student_id,
      details: { guardian: link.guardian_student_id, relacao: link.relacao },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'link-revoke') {
    const linkId = String(body.link_id || '');
    const { data: link } = await supabase.from('guardian_links').select('*').eq('id', linkId).maybeSingle();
    if (!link) return NextResponse.json({ error: 'Vínculo não encontrado.' }, { status: 404 });
    if (!(await alunoVisivel(link.student_id))) {
      return NextResponse.json({ error: 'Aluno fora dos seus núcleos.' }, { status: 403 });
    }
    const { error } = await supabase
      .from('guardian_links')
      .update({
        status: 'revoked',
        revogado_em: new Date().toISOString(),
        revogado_por: `painel:${sess.u}`,
        revogado_motivo: String(body.motivo || ''),
        updated_at: new Date().toISOString(),
      })
      .eq('id', linkId);
    if (error) return NextResponse.json({ error: 'Não foi possível revogar.' }, { status: 500 });
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'vinculo_revogado',
      target_id: link.student_id, details: { guardian: link.guardian_student_id, motivo: body.motivo || '' },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'link-create') {
    const guardianId = String(body.guardian_student_id || '');
    const studentId = String(body.student_id || '');
    const relacao = String(body.relacao || 'responsavel_legal');
    if (!guardianId || !studentId) return NextResponse.json({ error: 'Dados incompletos.' }, { status: 400 });
    if (!(await alunoVisivel(studentId)) || !(await alunoVisivel(guardianId))) {
      return NextResponse.json({ error: 'Aluno fora dos seus núcleos.' }, { status: 403 });
    }
    // Perfil de responsável precisa existir (cria por baixo se admin pedir)
    if (body.criar_perfil) {
      const { data: g } = await supabase.from('guardians').select('student_id').eq('student_id', guardianId).maybeSingle();
      if (!g) {
        const { data: st } = await supabase.from('students').select('cpf').eq('id', guardianId).maybeSingle();
        await supabase.from('guardians').upsert(
          { student_id: guardianId, cpf_digits: String(st?.cpf || '').replace(/\D/g, '') },
          { onConflict: 'student_id' },
        );
      }
    }
    const { data: existente } = await supabase
      .from('guardian_links')
      .select('id, status')
      .eq('guardian_student_id', guardianId)
      .eq('student_id', studentId)
      .maybeSingle();
    if (existente) {
      const { error } = await supabase
        .from('guardian_links')
        .update({ status: 'active', aprovado_em: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', existente.id);
      if (error) return NextResponse.json({ error: 'Não foi possível atualizar.' }, { status: 500 });
    } else {
      const { error } = await supabase.from('guardian_links').insert({
        guardian_student_id: guardianId,
        student_id: studentId,
        relacao,
        status: 'active',
        criado_por: `painel:${sess.u}`,
        aprovado_em: new Date().toISOString(),
      });
      if (error) return NextResponse.json({ error: 'Não foi possível criar o vínculo.' }, { status: 500 });
    }
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'vinculo_criado',
      target_id: studentId, details: { guardian: guardianId, relacao },
    });
    return NextResponse.json({ success: true });
  }

  /* ── Autorização de adolescente ──────────────────────────────────────────── */
  if (action === 'authz-revoke') {
    const studentId = String(body.student_id || '');
    if (!(await alunoVisivel(studentId))) {
      return NextResponse.json({ error: 'Aluno fora dos seus núcleos.' }, { status: 403 });
    }
    const { error } = await supabase
      .from('adolescent_authorizations')
      .update({
        status: 'revoked',
        revogado_em: new Date().toISOString(),
        revogado_por: `painel:${sess.u}`,
        revogado_motivo: String(body.motivo || 'Revogado pelo painel'),
        updated_at: new Date().toISOString(),
      })
      .eq('student_id', studentId);
    if (error) return NextResponse.json({ error: 'Não foi possível revogar.' }, { status: 500 });
    await supabase.from('students').update({ assinatura_responsavel: false }).eq('id', studentId);
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'autorizacao_revogada',
      target_id: studentId, details: { motivo: body.motivo || '' },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'authz-reactivate') {
    // Reativa autorização existente (assinada anteriormente) — ex.: revogada por engano
    const studentId = String(body.student_id || '');
    if (!(await alunoVisivel(studentId))) {
      return NextResponse.json({ error: 'Aluno fora dos seus núcleos.' }, { status: 403 });
    }
    const { data: authz } = await supabase
      .from('adolescent_authorizations')
      .select('id, status')
      .eq('student_id', studentId)
      .maybeSingle();
    if (!authz) return NextResponse.json({ error: 'Nenhuma autorização encontrada.' }, { status: 404 });
    if (authz.status === 'pending') return NextResponse.json({ error: 'Autorização ainda pendente — peça ao aluno concluí-la no app.' }, { status: 422 });
    const { error } = await supabase
      .from('adolescent_authorizations')
      .update({ status: 'authorized', updated_at: new Date().toISOString() })
      .eq('student_id', studentId);
    if (error) return NextResponse.json({ error: 'Não foi possível reativar.' }, { status: 500 });
    await supabase.from('students').update({ assinatura_responsavel: true }).eq('id', studentId);
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'autorizacao_reativada',
      target_id: studentId,
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'authz-approve-direct') {
    // Conclusão presencial: o responsável assinou papel no núcleo e o admin
    // registra a conclusão (documento físico — evidência registrada).
    const studentId = String(body.student_id || '');
    if (!(await alunoVisivel(studentId))) {
      return NextResponse.json({ error: 'Aluno fora dos seus núcleos.' }, { status: 403 });
    }
    const respNome = String(body.resp_nome || '').trim();
    if (!respNome) return NextResponse.json({ error: 'Informe o nome do responsável.' }, { status: 400 });
    const { error } = await supabase
      .from('adolescent_authorizations')
      .upsert({
        student_id: studentId,
        status: 'authorized',
        resp_nome: respNome,
        resp_relacao: String(body.resp_relacao || 'responsavel_legal'),
        termo_versao: '1.0',
        metodo_autenticacao: 'presencial_papel',
        evidencias: { registrado_por: `painel:${sess.u}`, documento_fisico: true },
        assinatura_data: new Date().toISOString(),
      }, { onConflict: 'student_id' });
    if (error) return NextResponse.json({ error: 'Não foi possível registrar.' }, { status: 500 });
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'autorizacao_presencial_registrada',
      target_id: studentId, details: { resp_nome: respNome },
    });
    return NextResponse.json({ success: true });
  }

  /* ── CONTAS DE RESPONSÁVEL (aba dedicada) ────────────────────────────────── */

  if (action === 'editar-dados') {
    // Edita os dados pessoais da conta de responsável (mesma integridade da
    // edição de alunos: nome no padrão "Nome Sobrenome", sem duplicar nomes).
    const studentId = String(body.student_id || '');
    if (!studentId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
    if (nucleos !== 'geral') {
      // Visibilidade: núcleo próprio OU vínculo ativo com aluno do núcleo
      const { data: alvo } = await supabase
        .from('students').select('nucleo').eq('id', studentId).maybeSingle();
      let visivel = !!alvo && alunoDentroDosNucleos(alvo as { nucleo?: string | null }, nucleos);
      if (!visivel) {
        const { data: linksAlvo } = await supabase
          .from('guardian_links').select('student_id')
          .eq('guardian_student_id', studentId).eq('status', 'active');
        const ids = (linksAlvo || []).map(l => l.student_id);
        if (ids.length > 0) {
          const { data: alunosDosLinks } = await supabase
            .from('students').select('id, nucleo').in('id', ids);
          visivel = (alunosDosLinks || []).some(a => alunoDentroDosNucleos(a as { nucleo?: string | null }, nucleos));
        }
      }
      if (!visivel) return NextResponse.json({ error: 'Fora dos seus núcleos.' }, { status: 403 });
    }

    const { chaveDeNome, capitalizarNome } = await import('@/lib/nome');
    const payload: Record<string, unknown> = {};
    if (body.nome !== undefined) {
      const nome = capitalizarNome(String(body.nome || '').trim());
      if (nome.length < 3) return NextResponse.json({ error: 'Informe o nome completo.' }, { status: 400 });
      const chave = chaveDeNome(nome);
      const { data: conflito } = await supabase
        .from('students').select('id, nome_completo')
        .neq('id', studentId)
        .is('deleted_at', null)
        .ilike('nome_completo', nome);
      if ((conflito || []).some(c => chaveDeNome(c.nome_completo) === chave)) {
        return NextResponse.json({ error: 'Já existe uma conta com este nome no sistema.' }, { status: 409 });
      }
      payload.nome_completo = nome;
    }
    for (const campo of ['telefone', 'cep', 'endereco', 'numero', 'complemento', 'bairro', 'cidade', 'estado']) {
      if (body[campo] !== undefined) payload[campo] = String(body[campo] || '').trim() || null;
    }
    if (body.email !== undefined) {
      const email = String(body.email || '').trim().toLowerCase() || null;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return NextResponse.json({ error: 'E-mail inválido.' }, { status: 400 });
      }
      if (email) {
        const { data: conflitoEmail } = await supabase
          .from('students').select('id, nome_completo')
          .neq('id', studentId)
          .is('deleted_at', null)
          .eq('email', email)
          .maybeSingle();
        if (conflitoEmail) {
          return NextResponse.json({ error: `Este e-mail já está cadastrado para ${conflitoEmail.nome_completo}.` }, { status: 409 });
        }
      }
      payload.email = email;
    }
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: 'Nada para atualizar.' }, { status: 400 });
    }
    const { error } = await supabase.from('students').update(payload).eq('id', studentId);
    if (error) return NextResponse.json({ error: 'Não foi possível salvar os dados.' }, { status: 500 });
    // Mantém o acesso (login/e-mail) coerente quando o e-mail muda
    if (payload.email !== undefined) {
      try {
        const AUTH_KEY = 'config/aluno-auth.json';
        const { data: urlData } = await supabase.storage.from('photos').createSignedUrl(AUTH_KEY, 30);
        if (urlData?.signedUrl) {
          const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
          if (res.ok) {
            const authMap = (await res.json()) as Record<string, { email?: string }>;
            if (authMap[studentId]) {
              authMap[studentId].email = String(payload.email || '');
              const blob = new Blob([JSON.stringify(authMap, null, 2)], { type: 'application/json' });
              await supabase.storage.from('photos').upload(AUTH_KEY, blob, { upsert: true });
            }
          }
        }
      } catch { /* conta sem acesso — ok */ }
    }
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'responsavel_dados_editados',
      target_id: studentId, details: { campos: Object.keys(payload) },
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'remover-funcao') {
    // Remove a FUNÇÃO de responsável da conta (students.conta_tipo → null e
    // perfil desativado). Mantém a linha e os vínculos registrados. Se a conta
    // tem acesso próprio, ela volta a se comportar como aluno comum.
    const studentId = String(body.student_id || '');
    if (!studentId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
    if (nucleos !== 'geral') {
      const { data: alvo } = await supabase
        .from('students').select('nucleo').eq('id', studentId).maybeSingle();
      if (!alvo || !alunoDentroDosNucleos(alvo as { nucleo?: string | null }, nucleos)) {
        return NextResponse.json({ error: 'Fora dos seus núcleos.' }, { status: 403 });
      }
    }
    const { error } = await supabase
      .from('students').update({ conta_tipo: null }).eq('id', studentId);
    if (error) return NextResponse.json({ error: 'Não foi possível atualizar a conta.' }, { status: 500 });
    try {
      const { desativarPerfilResponsavel } = await import('@/lib/guardians');
      await desativarPerfilResponsavel(studentId);
    } catch { /* sem perfil ativo */ }
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'responsavel_funcao_removida',
      target_id: studentId,
    });
    return NextResponse.json({ success: true });
  }

  if (action === 'delete-account') {
    // Exclui a conta de ACESSO de um responsável (login/senha/dispositivos),
    // mantendo o cadastro. A conta permanece "só responsável" se tem
    // dependentes ativos; sem dependentes, volta a não ter tipo.
    const studentId = String(body.student_id || '');
    if (!studentId) return NextResponse.json({ error: 'student_id obrigatório.' }, { status: 400 });
    if (nucleos !== 'geral') {
      const { data: alvo } = await supabase
        .from('students').select('nucleo').eq('id', studentId).maybeSingle();
      if (!alvo || !alunoDentroDosNucleos(alvo as { nucleo?: string | null }, nucleos)) {
        return NextResponse.json({ error: 'Fora dos seus núcleos.' }, { status: 403 });
      }
    }
    // Mapa de contas do app (mesmo padrão das outras rotas: Storage como fonte)
    const AUTH_KEY = 'config/aluno-auth.json';
    const { data: urlData } = await supabase.storage.from('photos').createSignedUrl(AUTH_KEY, 30);
    let authMap: Record<string, Record<string, unknown>> = {};
    if (urlData?.signedUrl) {
      const res = await fetch(urlData.signedUrl, { cache: 'no-store' });
      if (res.ok) authMap = await res.json();
    }
    if (!authMap[studentId]) {
      return NextResponse.json({ error: 'Esta conta não tem acesso (login) para excluir.' }, { status: 404 });
    }
    delete authMap[studentId];
    const blob = new Blob([JSON.stringify(authMap, null, 2)], { type: 'application/json' });
    await supabase.storage.from('photos').upload(AUTH_KEY, blob, { upsert: true });
    try {
      await supabase.from('push_subscriptions').delete().eq('user_id', studentId);
      await supabase.from('notification_preferences').delete().eq('user_id', studentId);
    } catch { /* melhor-esforço */ }
    try {
      const { tutoradosDoResponsavel } = await import('@/lib/guardians');
      const tuts = await tutoradosDoResponsavel(studentId);
      if ((tuts || []).some(t => t.status_vinculo === 'active')) {
        await supabase.from('students').update({ conta_tipo: 'responsavel' }).eq('id', studentId);
      } else {
        await supabase.from('students').update({ conta_tipo: null }).eq('id', studentId);
      }
    } catch { /* sem vínculos */ }
    await appendAudit({
      actor: `painel:${sess.u}`, actor_type: 'admin', action: 'responsavel_acesso_excluido',
      target_id: studentId,
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
