'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Imagem carregada pelo usuário (arquivo local). */
  file: File;
  /** Chamado com o arquivo recortado quando o usuário confirma. */
  onConfirm: (file: File) => void;
  onCancel: () => void;
}

interface Handle {
  x: number;
  y: number;
  cursor: string;
}

const HANDLES: Handle[] = [
  { x: 0, y: 0, cursor: 'nwse-resize' },   // TL
  { x: 1, y: 0, cursor: 'nesw-resize' },   // TR
  { x: 0, y: 1, cursor: 'nesw-resize' },   // BL
  { x: 1, y: 1, cursor: 'nwse-resize' },   // BR
];

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const ctlBtn: React.CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 9,
  border: '1px solid var(--border, #e5e7eb)',
  background: 'var(--bg-input, #f3f4f6)',
  fontSize: 17,
  cursor: 'pointer',
  color: 'var(--text-primary, #111827)',
  fontWeight: 700,
};

export default function PhotoEditor({ file, onConfirm, onCancel }: Props) {
  const [imgSrc, setImgSrc] = useState<string>('');
  const [natW, setNatW] = useState(0);
  const [natH, setNatH] = useState(0);

  // Recorte em coordenadas da imagem natural (sem rotação)
  const [crop, setCrop] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [rotation, setRotation] = useState(0);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);

  const stageRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(0);
  const [stageH, setStageH] = useState(0);

  const dragRef = useRef<{
    mode: 'new' | 'move' | 'resize';
    handle?: Handle;
    startX: number;
    startY: number;
    orig: { x: number; y: number; w: number; h: number };
    prev: { x: number; y: number; w: number; h: number };
  } | null>(null);

  // Carrega a imagem e mede
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgSrc(url);
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      setNatW(w);
      setNatH(h);
      // Recorte quadrado inicial centralizado (padrão para foto de perfil)
      const side = Math.min(w, h) * 0.85;
      setCrop({ x: (w - side) / 2, y: (h - side) / 2, w: side, h: side });
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Mede o palco
  useEffect(() => {
    function measure() {
      const el = stageRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setStageW(r.width);
      setStageH(r.height);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Escala para a imagem (rotacionada) caber no palco
  const swapped = rotation % 180 !== 0;
  const fitScale = Math.min(
    (stageW - 16) / (swapped ? natH || 1 : natW || 1),
    (stageH - 16) / (swapped ? natW || 1 : natH || 1),
  );
  const scale = isFinite(fitScale) && fitScale > 0 ? fitScale : 1;

  const dispW = (swapped ? natH : natW) * scale;
  const dispH = (swapped ? natW : natH) * scale;

  // Recorte em coordenadas de exibição (pós-rotação), a partir do canto do palco
  function cropDisplay() {
    const c = crop;
    const w = c.w * scale;
    const h = c.h * scale;
    if (rotation === 0) return { x: c.x * scale, y: c.y * scale, w, h };
    if (rotation === 90) return { x: (natH - c.y - c.h) * scale, y: c.x * scale, w, h };
    if (rotation === 180) return { x: (natW - c.x - c.w) * scale, y: (natH - c.y - c.h) * scale, w, h };
    return { x: c.y * scale, y: (natW - c.x - c.w) * scale, w, h };
  }

  // Converte delta de exibição para coordenadas naturais (inverso da rotação)
  function toNatural(dx: number, dy: number): { dx: number; dy: number } {
    if (rotation === 0) return { dx, dy };
    if (rotation === 90) return { dx: -dy, dy: dx };
    if (rotation === 180) return { dx: -dx, dy: -dy };
    return { dx: dy, dy: -dx };
  }

  const onPointerDown = (e: React.PointerEvent, mode: 'new' | 'move' | 'resize', handle?: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    let anchor = { x: 0, y: 0, w: 0, h: 0 };
    if (mode === 'new' && stageRef.current && scale > 0) {
      // Ponto de clique em coordenadas naturais da imagem
      const rect = stageRef.current.getBoundingClientRect();
      const sx = e.clientX - rect.left - (stageW / 2 - dispW / 2);
      const sy = e.clientY - rect.top - (stageH / 2 - dispH / 2);
      const { dx: nx, dy: ny } = toNatural(sx, sy);
      anchor = {
        x: clamp(nx / scale, 0, natW),
        y: clamp(ny / scale, 0, natH),
        w: 0,
        h: 0,
      };
    }

    dragRef.current = { mode, handle, startX: e.clientX, startY: e.clientY, orig: mode === 'new' ? anchor : { ...crop }, prev: { ...crop } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Delta em pixels de exibição → converte para naturais e divide pela escala
    const nat = toNatural(e.clientX - drag.startX, e.clientY - drag.startY);
    const dx = nat.dx / (scale || 1);
    const dy = nat.dy / (scale || 1);

    if (drag.mode === 'move') {
      setCrop(() => ({
        ...drag.orig,
        x: clamp(drag.orig.x + dx, 0, Math.max(0, natW - drag.orig.w)),
        y: clamp(drag.orig.y + dy, 0, Math.max(0, natH - drag.orig.h)),
      }));
      return;
    }
    if (drag.mode === 'resize' && drag.handle) {
      const { handle } = drag;
      setCrop(() => {
        const MIN = 24;
        let x1 = drag.orig.x;
        let y1 = drag.orig.y;
        let x2 = drag.orig.x + drag.orig.w;
        let y2 = drag.orig.y + drag.orig.h;
        if (handle.x === 0) x1 = clamp(x1 + dx, 0, x2 - MIN);
        if (handle.x === 1) x2 = clamp(x2 + dx, x1 + MIN, natW);
        if (handle.y === 0) y1 = clamp(y1 + dy, 0, y2 - MIN);
        if (handle.y === 1) y2 = clamp(y2 + dy, y1 + MIN, natH);
        return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      });
      return;
    }
    // 'new' — retângulo ancorado no clique inicial
    setCrop(() => {
      const x = Math.min(drag.orig.x, drag.orig.x + dx);
      const y = Math.min(drag.orig.y, drag.orig.y + dy);
      return {
        x,
        y,
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
    });
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    if (drag && drag.mode === 'new') {
      // Clique sem arrastar: mantém o recorte anterior em vez de zerar
      setCrop(prev => (prev.w < 24 || prev.h < 24 ? drag.prev : prev));
    }
    dragRef.current = null;
  };

  // Exporta o recorte como JPEG, aplicando rotação e ajustes
  const confirm = useCallback(async () => {
    if (!imgSrc || crop.w < 24 || crop.h < 24) return;
    const img = new Image();
    img.src = imgSrc;
    await new Promise<void>(res => {
      if (img.complete) res();
      else img.onload = () => res();
    });

    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(crop.w));
    out.height = Math.max(1, Math.round(crop.h));
    const ctx = out.getContext('2d');
    if (!ctx) return;

    ctx.save();
    try {
      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%)`;
    } catch {}
    ctx.translate(out.width / 2, out.height / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    const dw = rotation % 180 === 0 ? out.width : out.height;
    const dh = rotation % 180 === 0 ? out.height : out.width;
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();

    out.toBlob(
      blob => {
        if (!blob) return;
        const base = file.name.replace(/\.[^.]+$/, '') || 'foto';
        const edited = new File([blob], `${base}-editada.jpg`, { type: 'image/jpeg' });
        onConfirm(edited);
      },
      'image/jpeg',
      0.92,
    );
  }, [imgSrc, crop, rotation, brightness, contrast, file, onConfirm]);

  const cd = cropDisplay();
  const cropStyle: React.CSSProperties = {
    position: 'absolute',
    left: `calc(50% + ${cd.x - dispW / 2}px)`,
    top: `calc(50% + ${cd.y - dispH / 2}px)`,
    width: cd.w,
    height: cd.h,
    border: '2px solid #FF9200',
    boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)',
    cursor: 'move',
    touchAction: 'none',
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)',
          borderRadius: 16,
          maxWidth: 620,
          width: '94%',
          maxHeight: '92vh',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.45)',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border, #e5e7eb)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'var(--text-primary, #111827)' }}>✂️ Ajustar foto</div>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-secondary, #6b7280)', lineHeight: 1 }} aria-label="Fechar editor">×</button>
        </div>

        {/* Palco */}
        <div
          ref={stageRef}
          onPointerDown={e => onPointerDown(e, 'new')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          style={{ position: 'relative', background: '#111', height: 340, overflow: 'hidden', touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imgSrc}
            alt=""
            draggable={false}
            style={{
              position: 'absolute',
              left: `calc(50% - ${dispW / 2}px)`,
              top: `calc(50% - ${dispH / 2}px)`,
              width: dispW || undefined,
              height: dispH || undefined,
              maxWidth: 'none',
              transform: `rotate(${rotation}deg)`,
              filter: `brightness(${brightness}%) contrast(${contrast}%)`,
              pointerEvents: 'none',
            }}
          />
          {/* Overlay do recorte */}
          {stageW > 0 && cd.w > 0 && (
            <div style={cropStyle} onPointerDown={e => onPointerDown(e, 'move')}>
              {HANDLES.map(h => (
                <div
                  key={`${h.x}-${h.y}`}
                  onPointerDown={e => onPointerDown(e, 'resize', h)}
                  style={{
                    position: 'absolute',
                    width: 16,
                    height: 16,
                    left: h.x === 0 ? -8 : undefined,
                    right: h.x === 1 ? -8 : undefined,
                    top: h.y === 0 ? -8 : undefined,
                    bottom: h.y === 1 ? -8 : undefined,
                    background: '#FF9200',
                    borderRadius: 3,
                    cursor: h.cursor,
                    touchAction: 'none',
                  }}
                />
              ))}
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  backgroundImage:
                    'linear-gradient(rgba(255,255,255,0.25) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.25) 1px, transparent 1px)',
                  backgroundSize: '33.4% 33.4%',
                }}
              />
            </div>
          )}
        </div>

        {/* Controles */}
        <div style={{ padding: '12px 18px 6px', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <button type="button" onClick={() => setRotation((rotation + 270) % 360)} title="Girar à esquerda" style={ctlBtn}>↺</button>
          <button type="button" onClick={() => setRotation((rotation + 90) % 360)} title="Girar à direita" style={ctlBtn}>↻</button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary, #6b7280)' }}>
            Brilho
            <input type="range" min={50} max={150} value={brightness} onChange={e => setBrightness(Number(e.target.value))} style={{ width: 90 }} />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--text-secondary, #6b7280)' }}>
            Contraste
            <input type="range" min={50} max={150} value={contrast} onChange={e => setContrast(Number(e.target.value))} style={{ width: 90 }} />
          </label>
        </div>

        {/* Ações */}
        <div style={{ padding: '10px 18px 18px', display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ flex: 1, padding: 11, borderRadius: 10, background: 'var(--bg-input, #f3f4f6)', border: '1px solid var(--border, #e5e7eb)', color: 'var(--text-secondary, #6b7280)', fontWeight: 700, cursor: 'pointer' }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={!imgSrc || crop.w < 24}
            style={{ flex: 2, padding: 11, borderRadius: 10, background: 'linear-gradient(135deg,#FF9200,#d97706)', border: 'none', color: '#fff', fontWeight: 800, cursor: 'pointer', opacity: !imgSrc || crop.w < 24 ? 0.5 : 1 }}
          >
            ✅ Usar esta foto
          </button>
        </div>
      </div>
    </div>
  );
}
