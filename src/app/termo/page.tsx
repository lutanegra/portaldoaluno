'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { menorDeIdade } from '@/lib/idade';
import AssinaturaCanvas from '@/components/AssinaturaCanvas';

interface Student {
  id: string;
  nome_completo: string;
  cpf: string;
  identidade?: string | null;
  data_nascimento: string;
  nome_pai: string;
  nome_mae: string;
  nucleo: string | null;
  nome_responsavel: string | null;
  cpf_responsavel: string | null;
  assinatura_responsavel: boolean;
  assinatura_pai: boolean;
  assinatura_mae: boolean;
  menor_de_idade: boolean;
  assinatura_png?: string | null;
}

const ORG_PADRAO = 'Centro Cultural Luta Negra';

function TermoContent() {
  const params = useSearchParams();
  const studentId = params.get('id');

  const [student, setStudent] = useState<Student | null>(null);
  const [orgNome, setOrgNome] = useState(ORG_PADRAO);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [erro, setErro] = useState('');
  const [assinaturaPng, setAssinaturaPng] = useState<string | null>(null);

  const [form, setForm] = useState({
    nome_responsavel: '',
    cpf_responsavel: '',
  });
  const [assinatura, setAssinatura] = useState('');

  useEffect(() => {
    // Nome do grupo vem da configuração do sistema (com fallback local)
    fetch('/api/public/config')
      .then(r => (r.ok ? r.json() : null))
      .then(c => { if (c?.organization_name) setOrgNome(c.organization_name); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!studentId) { setNotFound(true); setLoading(false); return; }
    loadStudent(studentId);
  }, [studentId]);

  const loadStudent = async (id: string) => {
    try {
      // Tenta via API server-side primeiro (mais confiável)
      const res = await fetch(`/api/termo?id=${encodeURIComponent(id)}`);
      if (res.ok) {
        const s = await res.json() as Student;
        setStudent(s);
        setForm({ nome_responsavel: s.nome_responsavel || '', cpf_responsavel: s.cpf_responsavel || '' });
        if (s.assinatura_responsavel) {
          setSaved(true);
          setAssinaturaPng(s.assinatura_png || null);
        }
        setLoading(false);
        return;
      }
      // Fallback: acesso direto ao Supabase
      const { data, error } = await supabase
        .from('students')
        .select('id,nome_completo,cpf,identidade,data_nascimento,nome_pai,nome_mae,nucleo,nome_responsavel,cpf_responsavel,assinatura_responsavel,assinatura_pai,assinatura_mae,menor_de_idade')
        .eq('id', id)
        .single();
      if (error || !data) throw new Error(error?.message || 'not found');
      const s = { ...data, assinatura_pai: data.assinatura_pai ?? false, assinatura_mae: data.assinatura_mae ?? false } as Student;
      setStudent(s);
      setForm({ nome_responsavel: s.nome_responsavel || '', cpf_responsavel: s.cpf_responsavel || '' });
      if (s.assinatura_responsavel) setSaved(true);
    } catch {
      setNotFound(true);
    }
    setLoading(false);
  };

  const formatCPF = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`;
    return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`;
  };

  const cpfValido = (() => {
    const d = form.cpf_responsavel.replace(/\D/g, '');
    if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(d[i]) * (10 - i);
    let r = (soma * 10) % 11; if (r === 10 || r === 11) r = 0;
    if (r !== parseInt(d[9])) return false;
    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(d[i]) * (11 - i);
    r = (soma * 10) % 11; if (r === 10 || r === 11) r = 0;
    return r === parseInt(d[10]);
  })();

  const podeAssinar = !!form.nome_responsavel.trim() && cpfValido && !!assinatura;

  const nucleoFaltando = !String(student?.nucleo || '').trim();

  // ── GATE: cadastro-base completo antes do termo (espelha o servidor) ──────
  const faltandoBase = !student ? [] : (() => {
    const out: string[] = [];
    if (!String(student.nome_completo || '').trim()) out.push('Nome Completo');
    const cpfD = student.cpf?.replace(/\D/g, '') || '';
    if (!cpfD || cpfD.length !== 11 || /^(\d)\1{10}$/.test(cpfD)) out.push('CPF do aluno');
    if (!String(student.identidade || '').trim()) out.push('RG do aluno');
    if (!String(student.data_nascimento || '').trim()) out.push('Data de Nascimento');
    if (nucleoFaltando) out.push('Núcleo');
    return out;
  })();
  const cadastroBaseOk = faltandoBase.length === 0;

  const handleSave = async () => {
    if (!student) return;
    if (!form.nome_responsavel.trim()) {
      setErro('Preencha o nome do responsável antes de salvar.');
      return;
    }
    if (!assinatura) {
      setErro('Falta a assinatura — desenhe no espaço indicado.');
      return;
    }
    if (!cadastroBaseOk) {
      setErro(`Complete os dados obrigatórios do cadastro antes de preencher o Termo de Responsabilidade: ${faltandoBase.join(', ')}.`);
      return;
    }
    setErro('');
    setSaving(true);
    try {
      // Salva via API server-side (usa service role, mais confiável)
      const res = await fetch(`/api/termo?id=${student.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nome_responsavel: form.nome_responsavel,
          cpf_responsavel: form.cpf_responsavel,
          assinatura_trajeto: assinatura,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || 'api error');
      if (d.assinatura_png) setAssinaturaPng(d.assinatura_png);
      setSaved(true);
      setStudent(prev => prev ? { ...prev, ...form, assinatura_responsavel: true } : prev);
    } catch (e) {
      setErro(e instanceof Error && e.message !== 'api error' ? e.message : 'Erro ao salvar. Tente novamente.');
    }
    setSaving(false);
  };

  const hoje = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
      Carregando...
    </div>
  );

  if (notFound || !student) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontSize: '2rem' }}>⚠</div>
      <div style={{ fontWeight: 700 }}>Aluno não encontrado</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Verifique o link enviado.</div>
    </div>
  );

  if (!menorDeIdade(student.data_nascimento, student.menor_de_idade)) return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <div style={{ fontSize: '2rem' }}>ℹ️</div>
      <div style={{ fontWeight: 700 }}>Termo não aplicável</div>
      <div style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Este aluno é maior de idade e não necessita de autorização.</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', padding: '32px 16px' }}>
      <div style={{ maxWidth: 680, margin: '0 auto' }}>

        {/* Cabeçalho */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <img src="/logo-portal-aluno.png" alt="Logo Portal Aluno" style={{ width: 110, height: 110, objectFit: 'contain', marginBottom: 14, display: 'block', margin: '0 auto 14px' }} />
          <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 4 }}>Termo de Autorização</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {orgNome}
          </p>
        </div>

        {/* Documento */}
        <div style={{
          background: 'var(--bg-card)',
          border: '2px solid #dc2626',
          borderRadius: 16,
          overflow: 'hidden',
          marginBottom: 24,
        }}>
          {/* Título */}
          <div style={{ background: '#dc2626', padding: '16px 24px', textAlign: 'center' }}>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: '1rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              ⚠ Autorização de Participação — Menor de Idade
            </div>
          </div>

          <div style={{ padding: '28px 28px 24px', fontFamily: 'Georgia, serif' }}>

            {/* Dados do aluno */}
            <div style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 18px', marginBottom: 24, fontFamily: 'sans-serif' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Dados do Aluno</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: '0.85rem' }}>
                <div><span style={{ color: 'var(--text-secondary)' }}>Nome:</span> <strong>{student.nome_completo}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Núcleo:</span> <strong>{student.nucleo || '—'}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Nascimento:</span> <strong>{student.data_nascimento ? new Date(student.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR') : '—'}</strong></div>
                <div><span style={{ color: 'var(--text-secondary)' }}>Data:</span> <strong>{hoje}</strong></div>
              </div>
            </div>

            {/* Texto do termo */}
            <p style={{ textAlign: 'justify', lineHeight: 1.9, marginBottom: 28, fontSize: '0.93rem' }}>
              Eu, responsável legal pelo menor inscrito, autorizo sua participação nas atividades de capoeira
              realizadas pelo <strong>{orgNome}</strong>, estando ciente
              das atividades físicas envolvidas.
            </p>

            <hr style={{ border: 'none', borderTop: '1px dashed rgba(220,38,38,0.3)', marginBottom: 24 }} />

            {/* Campos responsável */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20, fontFamily: 'sans-serif' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                  Responsável <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  value={form.nome_responsavel}
                  onChange={e => setForm(p => ({ ...p, nome_responsavel: e.target.value }))}
                  placeholder="Nome completo do responsável legal"
                  disabled={saved}
                  style={{ width: '100%', fontFamily: 'Georgia, serif', opacity: saved ? 0.7 : 1 }}
                />
              </div>
              <div>
                <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                  CPF <span style={{ color: '#dc2626' }}>*</span>
                </label>
                <input
                  value={form.cpf_responsavel}
                  onChange={e => setForm(p => ({ ...p, cpf_responsavel: formatCPF(e.target.value) }))}
                  placeholder="000.000.000-00"
                  disabled={saved}
                  style={{ opacity: saved ? 0.7 : 1 }}
                />
              </div>
            </div>

            {/* Assinatura eletrônica */}
            <div style={{ fontFamily: 'sans-serif' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>
                Assinatura do Responsável <span style={{ color: '#dc2626' }}>*</span>
              </label>
              {saved ? (
                assinaturaPng ? (
                  <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 10, padding: 8, textAlign: 'center' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={assinaturaPng} alt="Assinatura do responsável" style={{ height: 90, maxWidth: '100%', objectFit: 'contain' }} />
                  </div>
                ) : (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', border: '1.5px dashed var(--border)', borderRadius: 10, padding: 18, textAlign: 'center' }}>
                    Assinatura registrada em {hoje}
                  </div>
                )
              ) : (
                <AssinaturaCanvas onTrajeto={(t, valido) => setAssinatura(valido ? t : '')} altura={150} />
              )}
              <div style={{ marginTop: 10, fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                A assinatura eletrônica registra a manifestação de vontade por meio eletrônico, com data, hora e identificação do dispositivo.
              </div>
            </div>

          </div>
        </div>

        {/* Erro */}
        {erro && (
          <div style={{ background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.35)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#f87171', fontSize: '0.84rem', fontWeight: 600 }}>
            {erro}
          </div>
        )}

        {/* Gate: cadastro-base incompleto — termo indisponível com motivo */}
        {!saved && !cadastroBaseOk && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#fbbf24', fontSize: '0.84rem', fontWeight: 600 }}>
            ⚠ Complete os dados obrigatórios do cadastro antes de preencher o Termo de Responsabilidade. Faltando: <strong>{faltandoBase.join(', ')}</strong>. Peça ao admin do núcleo para completar o cadastro do aluno.
          </div>
        )}

        {/* Núcleo pendente — o termo precisa dele para ser salvo */}
        {!saved && nucleoFaltando && (
          <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 14, color: '#fbbf24', fontSize: '0.84rem', fontWeight: 600 }}>
            ⚠ O cadastro deste aluno ainda não tem <strong>núcleo de treino</strong>. Peça ao admin para preencher o núcleo — sem ele o termo não pode ser salvo.
          </div>
        )}

        {/* Botão salvar / status */}
        {saved ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: 'rgba(22,163,74,0.1)', border: '1px solid rgba(22,163,74,0.3)', borderRadius: 12, padding: '16px 20px', textAlign: 'center', color: '#16a34a', fontWeight: 700, fontSize: '0.95rem' }}>
              ✅ Termo assinado e salvo com sucesso!<br />
              <span style={{ fontWeight: 400, fontSize: '0.82rem', color: 'var(--text-secondary)' }}>O documento fica salvo na conta do aluno — o admin também o visualiza na aba Alunos.</span>
            </div>
            <button
              onClick={() => window.print()}
              style={{
                width: '100%', padding: '15px',
                background: 'linear-gradient(135deg,#16a34a,#15803d)',
                border: 'none', color: '#fff', borderRadius: 12, fontWeight: 700, fontSize: '0.95rem',
                cursor: 'pointer', boxShadow: '0 4px 16px rgba(22,163,74,0.3)',
              }}
            >
              ⬇ Salvar PDF / Imprimir
            </button>
          </div>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving || !podeAssinar || !cadastroBaseOk}
            style={{
              width: '100%', padding: '16px',
              background: podeAssinar && cadastroBaseOk ? 'linear-gradient(135deg,#dc2626,#b91c1c)' : 'var(--bg-input)',
              border: podeAssinar && cadastroBaseOk ? 'none' : '1px solid var(--border)',
              color: podeAssinar && cadastroBaseOk ? '#fff' : 'var(--text-secondary)',
              borderRadius: 12, fontWeight: 700, fontSize: '1rem',
              cursor: podeAssinar && cadastroBaseOk ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: podeAssinar && cadastroBaseOk ? '0 4px 16px rgba(220,38,38,0.3)' : 'none',
            }}
          >
            {saving ? 'Salvando...' : !cadastroBaseOk ? 'Termo bloqueado — complete o cadastro' : '✍ Confirmar e Assinar Termo'}
          </button>
        )}
      </div>
    </div>
  );
}

export default function TermoPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Carregando...</div>}>
      <TermoContent />
    </Suspense>
  );
}
