/**
 * BIBLIOTECA CENTRAL DE NOME — Ginga Gestão
 *
 * Duas garantias usadas por TODAS as rotas que criam ou alteram o nome:
 *
 * 1. NORMALIZAÇÃO: "MARIA EDUARDA SANTANA DE FARIAS" → "Maria Eduarda Santana de Farias".
 *    Primeira letra de cada palavra em maiúscula; conectivos (de, da, do, das, dos, e)
 *    permanecem em minúscula — padrão "Nome Sobrenome".
 *
 * 2. IGUALDADE: duas pessoas são "a mesma" quando os nomes coincidem ignorando
 *    maiúsculas, acentos e espaços extras (JOÃO == Joao == joao == João).
 *    Usada na trava anti-duplicidade — o nome nunca é chave de vínculo, só de
 *    recusa de cadastro repetido.
 */

/** Conectivos que ficam em minúscula na capitalização (exceto na 1ª palavra). */
const CONECTIVOS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Normaliza o nome ENQUANTO O USUÁRIO DIGITA (onChange): colapsa espaços
 * duplicados, mas PRESERVA espaço no final — typing "Maria " não pode perder
 * o espaço antes do sobrenome. NÃO capitaliza (a correção de maiúsculas é
 * feita pelo capitalizarNome no servidor, ao salvar, sem atrapalhar a digitação).
 */
export function entradaNome(input: string): string {
  const bruto = String(input || '');
  const fimComEspaco = /\s$/.test(bruto);
  const limpo = bruto.replace(/\s+/g, ' ');
  return fimComEspaco ? limpo + ' ' : limpo;
}

/**
 * Capitaliza um nome no padrão "Nome Sobrenome": cada palavra com inicial
 * maiúscula e restante minúsculo; conectivos em minúscula (a primeira palavra
 * sempre capitalizada). Idempotente — já capitalizado volta igual.
 */
export function capitalizarNome(input: string): string {
  const bruto = String(input || '').trim().replace(/\s+/g, ' ');
  if (!bruto) return '';
  const partes = bruto.toLowerCase().split(' ');
  return partes
    .map((p, i) => (i > 0 && CONECTIVOS.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(' ');
}

/**
 * Chave de comparação de nomes: minúsculo, sem acentos, um espaço entre palavras.
 * DOIS NOMES COM A MESMA CHAVE SÃO A MESMA PESSOA para efeito de duplicidade.
 */
export function chaveDeNome(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** true quando os dois nomes representam a mesma pessoa (ver chaveDeNome). */
export function mesmoNome(a: string, b: string): boolean {
  const ka = chaveDeNome(a);
  return ka.length > 0 && ka === chaveDeNome(b);
}
