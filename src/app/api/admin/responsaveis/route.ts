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

  return NextResponse.json({
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

  return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
}
