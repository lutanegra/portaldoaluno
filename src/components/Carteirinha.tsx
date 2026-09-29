'use client';
import { getCordaColors, nomenclaturaGraduacao } from '@/lib/graduacoes';
import { useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { useSystemConfig } from '@/hooks/useSystemConfig';

export interface CarteirinhaData {
  nome: string;
  cpf: string;
  identidade: string;
  nucleo: string;
  graduacao: string;
  tipo_graduacao: string;
  foto_url: string | null;
  menor_de_idade: boolean;
  nome_pai: string;
  nome_mae: string;
  nome_responsavel: string | null;
  cpf_responsavel: string | null;
  inscricao_numero?: number | null;
  telefone?: string | null;
  apelido?: string | null;
  nome_social?: string | null;
  sexo?: string | null;
  student_id?: string | null;
  data_nascimento?: string | null;
}

interface Props {
  data: CarteirinhaData;
}

function QRCodeCanvas({ value, size }: { value: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        color: { dark: '#0a0a0a', light: '#ffffff' },
      }).catch(() => {});
    }
  }, [value, size]);
  return <canvas ref={canvasRef} width={size} height={size} style={{ display: 'block' }} />;
}

export default function Carteirinha({ data }: Props) {
  const { config: sysConfig } = useSystemConfig();
  const colors = getCordaColors(data.graduacao);
  const nomenclatura = nomenclaturaGraduacao[data.graduacao] || '';
  // Assinatura dinamica do sistema
  const sig = {
    imgSrc: sysConfig.signature_image_url || '/logo-portal-aluno.png',
    nome: sysConfig.signature_name || 'Administrador do Sistema',
    cargo: sysConfig.signature_role || sysConfig.organization_name
  };

  // Validity: 1 year from today
  const hoje = new Date();
  const validade = new Date(hoje);
  validade.setFullYear(validade.getFullYear() + 1);
  const emissaoStr = hoje.toLocaleDateString('pt-BR');
  const validadeStr = validade.toLocaleDateString('pt-BR');

  // QR code — URL de verificacao publica da carteirinha
  const idPrefix = sysConfig.id_prefix || 'CCLN';
  const matriculaStr = data.inscricao_numero != null ? `${idPrefix}-${String(data.inscricao_numero).padStart(3, '0')}` : '';
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  // Prefer UUID (always works), fallback to matricula number
  const qrValue = data.student_id
    ? `${baseUrl}/verificar?id=${data.student_id}`
    : matriculaStr
      ? `${baseUrl}/verificar?mat=${matriculaStr}`
      : `${baseUrl}/verificar`;

  const displayName = data.nome_social || data.nome;

  return (
    <div
      id="carteirinha-print"
      style={{
        width: 540,
        minHeight: 300,
        background: '#0a0a0a',
        borderRadius: 12,
        overflow: 'hidden',
        border: '2px solid #FF9200',
        fontFamily: 'Inter, Arial, sans-serif',
        boxShadow: '0 6px 28px rgba(255,146,0,0.25)',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Top stripe — laranja sobre preto */}
      <div style={{ height: 6, background: 'linear-gradient(90deg,#FF9200,#fbbf24)', flexShrink: 0 }} />

      {/* Header — preto com detalhes laranja */}
      <div style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 60%, #0a0a0a 100%)',
        padding: '10px 16px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        position: 'relative',
        flexShrink: 0,
        borderBottom: '1px solid rgba(255,146,0,0.35)',
      }}>
        {/* Logo + org name centered */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={sysConfig.logo_url || '/logo-portal-aluno.png'} alt={sysConfig.organization_short} style={{ width: 44, height: 44, objectFit: 'contain', flexShrink: 0 }} />
          <div style={{ textAlign: 'center' }}>
            <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.52rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {sysConfig.card_title || 'Carteira de Identificacao'}
            </div>
            <div style={{ color: '#FF9200', fontSize: '1rem', fontWeight: 900, letterSpacing: '0.04em', textTransform: 'uppercase', lineHeight: 1.15 }}>
              {sysConfig.organization_short}
            </div>
            <div style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.5rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 1 }}>
              {sysConfig.card_subtitle || 'Membro Ativo'}
            </div>
          </div>
        </div>

        {/* Matricula badge top-right */}
        {data.inscricao_numero != null && (
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', textAlign: 'right', background: 'rgba(255,146,0,0.12)', border: '1px solid rgba(255,146,0,0.4)', borderRadius: 6, padding: '3px 8px' }}>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.42rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Matrícula</div>
            <div style={{ color: '#FF9200', fontSize: '0.68rem', fontWeight: 900, letterSpacing: '0.04em' }}>
              {idPrefix}-{String(data.inscricao_numero).padStart(3, '0')}
            </div>
          </div>
        )}
      </div>

      {/* Main body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* LEFT — photo + cord + QR */}
        <div style={{
          width: 116,
          background: 'linear-gradient(180deg, #161616 0%, #0f0f0f 100%)',
          borderRight: '2px solid rgba(255,146,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '10px 8px 8px',
          gap: 5,
          flexShrink: 0,
        }}>
          {data.foto_url ? (
            <img
              src={data.foto_url}
              alt=""
              style={{ width: 72, height: 88, objectFit: 'cover', borderRadius: 6, border: '2px solid #FF9200' }}
              crossOrigin="anonymous"
            />
          ) : (
            <div style={{ width: 72, height: 88, borderRadius: 6, background: '#1f1f1f', border: '2px solid rgba(255,146,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF9200" strokeWidth="1.5"><circle cx="12" cy="8" r="4"/><path d="M6 21v-2a6 6 0 0112 0v2"/></svg>
            </div>
          )}
          {/* Cord bar */}
          <div style={{ display: 'flex', width: 72, height: 8, borderRadius: 4, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.35)' }}>
            {colors.map((c, i) => (
              <div key={i} style={{ flex: 1, background: c === '#FFFFFF' ? '#e5e7eb' : c }} />
            ))}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.44rem', textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'center', fontWeight: 700 }}>
            {data.nucleo}
          </div>
          {/* QR Code — below nucleo, full and scannable */}
          <div style={{ background: '#fff', borderRadius: 5, padding: 3, border: '1px solid rgba(255,146,0,0.5)', boxShadow: '0 1px 4px rgba(255,146,0,0.18)', marginTop: 2 }}>
            <QRCodeCanvas value={qrValue} size={80} />
          </div>
          <div style={{ color: 'rgba(255,146,0,0.8)', fontSize: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center', fontWeight: 700, lineHeight: 1 }}>
            scan
          </div>
        </div>

        {/* CENTER — info */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 10px 6px', overflow: 'hidden' }}>

          {/* Name + nomenclatura */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ color: '#ffffff', fontWeight: 800, fontSize: '0.85rem', lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
            {data.nome_social && data.nome_social !== data.nome && (
              <div style={{ color: 'rgba(255,255,255,0.55)', fontSize: '0.55rem', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>({data.nome})</div>
            )}
            {data.apelido && (
              <div style={{ color: '#FF9200', fontSize: '0.58rem', fontStyle: 'italic', marginTop: 1 }}>"{data.apelido}"</div>
            )}
            {nomenclatura && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 3 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF9200', flexShrink: 0 }} />
                <span style={{ background: 'linear-gradient(90deg,#FF9200,#d97706)', color: '#0a0a0a', fontSize: '0.5rem', fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase', borderRadius: 4, padding: '2px 7px' }}>
                  {nomenclatura}
                </span>
              </div>
            )}
          </div>

          {/* Data grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 10px', flex: 1 }}>
            {[
              ['CPF', data.cpf],
              data.identidade ? ['RG', data.identidade] : null,
              data.data_nascimento ? ['Nasc.', new Date(data.data_nascimento + 'T12:00:00').toLocaleDateString('pt-BR')] : null,
              ['Corda', data.graduacao],
              ['Tipo', data.tipo_graduacao === 'infantil' ? 'Infantil' : 'Adulta'],
              data.nome_pai ? ['Pai', data.nome_pai] : null,
              data.nome_mae ? ['Mãe', data.nome_mae] : null,
              data.menor_de_idade && data.nome_responsavel ? ['Resp.', data.nome_responsavel] : null,
            ].filter(Boolean).map((item) => {
              const [label, val] = item as string[];
              return val ? (
                <div key={label} style={{ display: 'flex', gap: 4, alignItems: 'baseline', minWidth: 0 }}>
                  <span style={{ color: '#FF9200', fontSize: '0.48rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.07em', flexShrink: 0 }}>{label}</span>
                  <span style={{ color: 'rgba(255,255,255,0.92)', fontSize: '0.6rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{val}</span>
                </div>
              ) : null;
            })}
          </div>

          {/* Signature — centered below data */}
          <div style={{ borderTop: '1.5px solid rgba(255,146,0,0.3)', paddingTop: 5, marginTop: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
            <img
              src={sig.imgSrc}
              alt="Assinatura"
              style={{ height: 28, maxWidth: 110, objectFit: 'contain', filter: 'brightness(0) invert(1)' }}
            />
            <div style={{ fontSize: '0.48rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.3, textAlign: 'center' }}>{sig.nome}</div>
            <div style={{ fontSize: '0.42rem', color: '#FF9200', textAlign: 'center' }}>{sig.cargo}</div>
          </div>
        </div>

      </div>

      {/* Footer — validity + emission */}
      <div style={{
        background: 'linear-gradient(90deg, #FF9200 0%, #fbbf24 50%, #FF9200 100%)',
        padding: '5px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <span style={{ color: 'rgba(10,10,10,0.85)', fontSize: '0.48rem', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
          Emitido: <strong>{emissaoStr}</strong>
        </span>
        <span style={{ color: '#0a0a0a', fontSize: '0.52rem', fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          ✦ Válida até {validadeStr} ✦
        </span>
        <span style={{ color: 'rgba(10,10,10,0.85)', fontSize: '0.48rem', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 }}>
          {sysConfig.organization_short || 'CCLN'}
        </span>
      </div>
    </div>
  );
}
