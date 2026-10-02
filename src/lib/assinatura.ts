/**
 * Renderização do trajeto da assinatura (formato "x,y;x,y;;..." — traços
 * separados por entrada vazia) em SVG e PNG (via data URI). Sem dependências
 * externas — browsers e ferramentas de impressão exibem SVG inline nativamente.
 */

export type TrajetoRender = {
  svg: string;
  largura: number;
  altura: number;
  tracos: number;
};

export function renderizarAssinaturaSvg(trajeto: string, largura = 560, altura = 180): TrajetoRender {
  const tracos = String(trajeto || '')
    .split(';')
    .reduce<Array<Array<[number, number]>>>((acc, ponto) => {
      if (!ponto.trim()) { acc.push([]); return acc; }
      const [x, y] = ponto.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        if (acc.length === 0) acc.push([]);
        acc[acc.length - 1].push([x, y]);
      }
      return acc;
    }, [])
    .filter(pontos => pontos.length >= 2);

  // Cada traço vira um <path> próprio — o "d" é o único atributo que o
  // renderizador do navegador desenha; texto solto dentro do <g> sai em branco.
  const paths = tracos
    .map(pontos => `<path d="M ${pontos.map(([x, y]) => `${x} ${y}`).join(' L ')}"/>`)
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${largura} ${altura}" width="${largura}" height="${altura}"><g fill="none" stroke="#111111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${paths}</g></svg>`;

  return { svg, largura, altura, tracos: tracos.length };
}

/** PNG em data URI (transparente) — compatível com janelas de impressão. */
export function assinaturaPngDataUri(trajeto: string, largura = 560, altura = 180): string | null {
  const r = renderizarAssinaturaSvg(trajeto, largura, altura);
  if (r.tracos === 0) return null;
  try {
    return `data:image/svg+xml;base64,${Buffer.from(r.svg, 'utf8').toString('base64')}`;
  } catch {
    return null;
  }
}
