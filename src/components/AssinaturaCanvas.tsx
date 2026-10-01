'use client';

import { useRef, useState } from 'react';

/**
 * Canvas de assinatura eletrônica do responsável.
 * O trajeto é entregue ao componente pai via onTrajeto no mesmo formato do
 * fluxo de autorização de adolescentes ("x,y;x,y;;x,y..." — traços separados
 * por entrada vazia), para o servidor renderizar a imagem da assinatura.
 */
export default function AssinaturaCanvas({
  onTrajeto,
  desabilitado = false,
  altura = 150,
}: {
  onTrajeto: (trajeto: string, valido: boolean) => void;
  desabilitado?: boolean;
  altura?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desenhandoRef = useRef(false);
  const trajetoRef = useRef<string[]>([]);
  const [quantidade, setQuantidade] = useState(0);

  const contarTracos = (t: string[]) => t.filter(s => s.trim()).length;

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const iniciarTraco = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (desabilitado) return;
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;
    desenhandoRef.current = true;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
    }
    const { x, y } = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(x, y);
    try { c.setPointerCapture(e.pointerId); } catch { /* ignora */ }
  };

  const moverTraco = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhandoRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const { x, y } = pos(e);
    ctx?.lineTo(x, y);
    ctx?.stroke();
    trajetoRef.current = [...trajetoRef.current.slice(-800), `${Math.round(x)},${Math.round(y)}`];
  };

  const soltarTraco = () => {
    if (!desenhandoRef.current) return;
    desenhandoRef.current = false;
    trajetoRef.current = [...trajetoRef.current, ''];
    setQuantidade(contarTracos(trajetoRef.current));
    onTrajeto(trajetoRef.current.join(';'), contarTracos(trajetoRef.current) >= 5);
  };

  const limpar = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext('2d');
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    trajetoRef.current = [];
    setQuantidade(0);
    onTrajeto('', false);
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={560}
        height={180}
        role="img"
        aria-label="Área de assinatura do responsável — desenhe a assinatura com o dedo ou mouse"
        onPointerDown={iniciarTraco}
        onPointerMove={moverTraco}
        onPointerUp={soltarTraco}
        onPointerLeave={soltarTraco}
        style={{
          width: '100%',
          height: altura,
          background: '#ffffff',
          border: '1.5px dashed #9ca3af',
          borderRadius: 10,
          touchAction: 'none',
          display: 'block',
          cursor: desabilitado ? 'default' : 'crosshair',
          opacity: desabilitado ? 0.6 : 1,
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 6 }}>
        <span style={{ fontSize: '0.72rem', color: '#8f8f8f' }}>
          {quantidade >= 5
            ? '✓ Assinatura registrada'
            : 'Desenhe a assinatura no espaço acima (dedo ou mouse)'}
        </span>
        {!desabilitado && (
          <button
            type="button"
            onClick={limpar}
            className="press"
            style={{ background: 'none', border: '1px solid rgba(255,255,255,0.14)', color: '#d4d4d4', borderRadius: 8, padding: '5px 12px', fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer' }}
          >
            Limpar assinatura
          </button>
        )}
      </div>
    </div>
  );
}
