/**
 * INTEGRAÇÕES DO SISTEMA DE NOTIFICAÇÕES — Ginga Gestão
 *
 * Toda decisão de destinatário acontece AQUI, no servidor, com base nos dados
 * reais (students, guardian_links, alunos-auth). O frontend nunca escolhe quem
 * recebe. Textos de push são curtos e sem dados sensíveis — o detalhe fica
 * dentro do app.
 */
import { createClient } from '@supabase/supabase-js';
import { criarNotificacao, notificarVarios, contasDoAlunoEResponsaveis, filtrarContasAtivas } from './notifications';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'dummy-key-for-build',
);

/* ── MURAL ────────────────────────────────────────────────────────────────── */

type MuralLike = {
  id: string;
  tipo: 'cartaz' | 'aviso';
  titulo: string;
  texto?: string;
  nucleos?: string[];
  autor?: string;
};

/**
 * Notifica a publicação do mural: sem etiqueta = todos os núcleos; com
 * etiqueta(s) = somente alunos daqueles núcleos. Destinatário = alunos com
 * conta + responsáveis com vínculo ativo.
 */
export async function notificarMural(item: MuralLike): Promise<{ criadas: number; pushesOk: number; pushesFalha: number }> {
  try {
    // Alunos dos núcleos-alvo
    let alunos: Array<{ id: string }> = [];
    const alvos = (item.nucleos || []).filter(Boolean);
    if (alvos.length > 0) {
      const slugs = alvos.map(s => s.toLowerCase());
      const { data: tenants } = await supabase.from('tenants').select('slug, nome').in('slug', slugs);
      const nomes = (tenants || []).map(t => String(t.nome || '').toLowerCase());
      const { data } = await supabase.from('students').select('id, nucleo').limit(5000);
      alunos = (data || [])
        .map(s => s as { id: string; nucleo: string | null })
        .filter(s => {
          const n = String(s.nucleo || '').trim().toLowerCase();
          return n && (slugs.includes(n) || nomes.includes(n));
        })
        .map(s => ({ id: s.id }));
    } else {
      const { data } = await supabase.from('students').select('id').limit(5000);
      alunos = (data || []).map(s => ({ id: s.id }));
    }
    const contas = await filtrarContasAtivas(alunos.map(a => a.id));
    // Responsáveis com vínculo ativo a qualquer aluno destinatário
    const { data: links } = await supabase
      .from('guardian_links')
      .select('guardian_student_id, student_id')
      .eq('status', 'active');
    const responsaveis = new Set<string>();
    for (const l of links || []) {
      if (contas.has(l.student_id)) responsaveis.add(l.guardian_student_id);
    }
    const respComConta = await filtrarContasAtivas(Array.from(responsaveis));
    const destinatarios = Array.from(new Set([...contas, ...respComConta]));
    if (destinatarios.length === 0) return { criadas: 0, pushesOk: 0, pushesFalha: 0 };

    const tipoLabel = item.tipo === 'cartaz' ? 'Novo cartaz no mural' : 'Novo aviso no mural';
    return await notificarVarios(destinatarios, {
      category: 'mural',
      type: 'mural_publicacao',
      title: tipoLabel,
      message: item.titulo,
      targetType: 'mural',
      targetId: item.id,
      dedupeKey: uid => `mural:${item.id}:${uid}`,
      pushTitle: tipoLabel,
      pushBody: `${item.titulo} — confira no Ginga Gestão.`,
      metadata: { autor: item.autor || '' },
    });
  } catch (e) {
    console.error('[notificacoes] mural:', e);
    return { criadas: 0, pushesOk: 0, pushesFalha: 0 };
  }
}

/* ── EVENTOS ──────────────────────────────────────────────────────────────── */

type EventoLike = { id: string; nome: string; data: string; hora?: string; nucleo?: string; participantes?: Array<{ student_id: string }> };

export async function notificarEvento(novo: EventoLike): Promise<{ criadas: number; pushesOk: number; pushesFalha: number }> {
  try {
    const quando = [novo.data, novo.hora].filter(Boolean).join(' às ');
    // Participantes têm prioridade; sem lista, núcleo inteiro
    let idsAlunos: string[] = [];
    if (Array.isArray(novo.participantes) && novo.participantes.length > 0) {
      idsAlunos = novo.participantes.map(p => p.student_id);
    } else if (novo.nucleo) {
      const slug = novo.nucleo.toLowerCase();
      const { data: t } = await supabase.from('tenants').select('nome').eq('slug', slug).maybeSingle();
      const nomeNucleo = String(t?.nome || '').toLowerCase();
      const { data } = await supabase.from('students').select('id, nucleo').limit(5000);
      idsAlunos = (data || [])
        .filter(s => {
          const n = String(s.nucleo || '').trim().toLowerCase();
          return n && (n === slug || (nomeNucleo && n === nomeNucleo));
        })
        .map(s => s.id);
    }
    const destinatarios = new Set<string>();
    for (const sid of idsAlunos) {
      for (const conta of await contasDoAlunoEResponsaveis(sid)) destinatarios.add(conta);
    }
    if (destinatarios.size === 0) return { criadas: 0, pushesOk: 0, pushesFalha: 0 };
    return await notificarVarios(Array.from(destinatarios), {
      category: 'eventos',
      type: 'evento_novo',
      title: 'Novo evento',
      message: `${novo.nome}${quando ? ` — ${quando}` : ''}`,
      targetType: 'evento',
      targetId: novo.id,
      dedupeKey: uid => `evento:${novo.id}:${uid}`,
      pushTitle: 'Novo evento',
      pushBody: `${novo.nome}${quando ? ` — ${quando}` : ''}. Confira os detalhes.`,
    });
  } catch (e) {
    console.error('[notificacoes] evento:', e);
    return { criadas: 0, pushesOk: 0, pushesFalha: 0 };
  }
}

/* ── PRESENÇA (chamada salva) ─────────────────────────────────────────────── */

/**
 * Notifica FALTAS registradas na chamada (presença normal não notifica —
 * evitaria um push por treino para cada aluno). Falta justificada (JU) não
 * notifica como falta.
 */
export async function notificarFaltasChamada(
  nucleoSlug: string,
  data: string,
  faltasIds: string[],
): Promise<void> {
  try {
    if (faltasIds.length === 0) return;
    const { data: tenant } = await supabase.from('tenants').select('nome').eq('slug', nucleoSlug).maybeSingle();
    const nomeNucleo = tenant?.nome || nucleoSlug;
    for (const sid of faltasIds) {
      const destinatarios = await contasDoAlunoEResponsaveis(sid);
      if (destinatarios.length === 0) continue;
      await notificarVarios(destinatarios, {
        category: 'presenca',
        type: 'presenca_falta',
        title: 'Falta registrada',
        message: `Falta registrada em ${nomeNucleo} no dia ${data.split('-').reverse().join('/')}. Se necessário, envie uma justificativa pelo app.`,
        targetType: 'justificativa',
        targetId: sid,
        dedupeKey: uid => `falta:${sid}:${nucleoSlug}:${data}:${uid}`,
        pushTitle: 'Falta registrada',
        pushBody: `Treino de ${data.split('-').reverse().join('/')} — veja detalhes e envie justificativa se aplicável.`,
        metadata: { student_id: sid, data, nucleo: nucleoSlug },
      });
    }
  } catch (e) {
    console.error('[notificacoes] faltas chamada:', e);
  }
}

/* ── JUSTIFICATIVAS ───────────────────────────────────────────────────────── */

export async function notificarJustificativaEnviada(just: { id: string; student_id: string; data_falta: string; enviado_por?: string }): Promise<void> {
  try {
    // Destinatário: os OUTROS membros da corrente (ex.: responsável enviou →
    // notifica a conta do aluno, se houver; aluno enviou → notifica responsáveis)
    const todos = new Set(await contasDoAlunoEResponsaveis(just.student_id));
    if (just.enviado_por === 'responsavel' && just.student_id) todos.add(just.student_id);
    const dataBR = just.data_falta.split('-').reverse().join('/');
    for (const uid of todos) {
      await criarNotificacao({
        userId: uid,
        category: 'justificativas',
        type: 'justificativa_enviada',
        title: 'Justificativa enviada',
        message: `Uma justificativa de falta (${dataBR}) foi enviada e aguarda análise.`,
        targetType: 'justificativa',
        targetId: just.id,
        dedupeKey: `just-env:${just.id}:${uid}`,
        pushTitle: 'Justificativa enviada',
        pushBody: 'Uma justificativa de falta foi enviada e aguarda análise.',
        metadata: { student_id: just.student_id },
      });
    }
  } catch (e) {
    console.error('[notificacoes] justificativa enviada:', e);
  }
}

export async function notificarDecisaoJustificativa(just: { id: string; student_id: string; data_falta: string; status: 'aprovado' | 'recusado'; resposta_mestre?: string }): Promise<void> {
  try {
    const destinatarios = await contasDoAlunoEResponsaveis(just.student_id);
    const aprovada = just.status === 'aprovado';
    const dataBR = just.data_falta.split('-').reverse().join('/');
    await notificarVarios(destinatarios, {
      category: 'justificativas',
      type: `justificativa_${just.status}`,
      title: aprovada ? 'Justificativa aprovada' : 'Justificativa recusada',
      message: `A justificativa da falta de ${dataBR} foi ${aprovada ? 'aprovada — a falta virou falta justificada' : 'recusada'}.`,
      targetType: 'justificativa',
      targetId: just.id,
      dedupeKey: uid => `just-dec:${just.id}:${uid}`,
      pushTitle: aprovada ? 'Justificativa aprovada' : 'Justificativa recusada',
      pushBody: `Justificativa de ${dataBR} — abra o app para ver a decisão.`,
      metadata: { student_id: just.student_id },
    });
  } catch (e) {
    console.error('[notificacoes] decisão justificativa:', e);
  }
}

/* ── GRADUAÇÃO ────────────────────────────────────────────────────────────── */

export async function notificarGraduacao(studentId: string, novaGraduacao: string, contexto: string): Promise<void> {
  try {
    const destinatarios = await contasDoAlunoEResponsaveis(studentId);
    await notificarVarios(destinatarios, {
      category: 'graduacao',
      type: 'graduacao_registrada',
      title: 'Graduação atualizada',
      message: `Nova graduação registrada: ${novaGraduacao} (${contexto}).`,
      targetType: 'graduacao',
      targetId: studentId,
      dedupeKey: uid => `grad:${studentId}:${novaGraduacao}:${contexto}:${uid}`,
      pushTitle: 'Graduação atualizada',
      pushBody: `Confira sua nova graduação no Ginga Gestão.`,
      metadata: { student_id: contexto === 'evento' ? studentId : undefined },
    });
  } catch (e) {
    console.error('[notificacoes] graduacao:', e);
  }
}

/* ── RESPONSÁVEIS E VÍNCULOS ──────────────────────────────────────────────── */

export async function notificarVinculo(
  evento: 'solicitado' | 'aprovado' | 'recusado' | 'revogado' | 'criado',
  alunoId: string,
  guardianId: string,
  detalhe?: { alunoNome?: string; guardianNome?: string },
): Promise<void> {
  try {
    const TITULOS: Record<string, { title: string; body: string }> = {
      solicitado: { title: 'Solicitação de vínculo', body: `${detalhe?.guardianNome || 'Um responsável'} pediu vínculo com seu perfil. Responda em Minha Conta.` },
      aprovado: { title: 'Vínculo aprovado', body: `${detalhe?.alunoNome || 'O aluno'} aprovou seu acesso como responsável.` },
      recusado: { title: 'Vínculo recusado', body: 'A solicitação de vínculo foi recusada pelo aluno.' },
      revogado: { title: 'Vínculo revogado', body: 'Um vínculo de responsável foi revogado. O acesso ao dependente foi encerrado.' },
      criado: { title: 'Novo dependente', body: `${detalhe?.alunoNome || 'Um dependente'} foi cadastrado na sua conta.` },
    };
    const meta = TITULOS[evento];

    if (evento === 'solicitado') {
      // Aluno decide → notifica a conta do aluno (se existir)
      const contas = await filtrarContasAtivas([alunoId]);
      for (const uid of contas) {
        await criarNotificacao({
          userId: uid, category: 'responsaveis', type: 'vinculo_solicitado',
          title: meta.title, message: meta.body, targetType: 'vinculo', targetId: alunoId,
          dedupeKey: `vinc:${guardianId}:${alunoId}:pending:${uid}`,
          pushTitle: meta.title, pushBody: 'Alguém pediu vínculo com seu perfil — responda em Minha Conta.',
        });
      }
      return;
    }

    // Demais eventos → notifica a conta do responsável
    const contasG = await filtrarContasAtivas([guardianId]);
    for (const uid of contasG) {
      await criarNotificacao({
        userId: uid, category: 'responsaveis', type: `vinculo_${evento}`,
        title: meta.title, message: meta.body, targetType: 'vinculo', targetId: alunoId,
        dedupeKey: `vinc:${guardianId}:${alunoId}:${evento}:${uid}`,
        pushTitle: meta.title, pushBody: meta.body,
      });
    }
  } catch (e) {
    console.error('[notificacoes] vinculo:', e);
  }
}

/* ── CONTA E SEGURANÇA (categoria obrigatória) ────────────────────────────── */

export async function notificarSeguranca(
  studentId: string,
  titulo: string,
  mensagem: string,
  type: string,
): Promise<void> {
  try {
    const contas = await filtrarContasAtivas([studentId]);
    for (const uid of contas) {
      await criarNotificacao({
        userId: uid,
        category: 'seguranca',
        type,
        title: titulo,
        message: mensagem,
        targetType: 'vinculo',
        targetId: studentId,
        pushTitle: titulo,
        pushBody: mensagem,
      });
    }
  } catch (e) {
    console.error('[notificacoes] seguranca:', e);
  }
}
