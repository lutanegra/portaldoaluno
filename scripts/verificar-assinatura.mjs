/**
 * Verificação pontual da correção da assinatura no PDF do termo (v1.4.2):
 * 1) o SVG gerado agora contém elementos <path> (antes: conteúdo solto no <g>, invisível);
 * 2) o SVG base64 decodifica para o mesmo conteúdo;
 * 3) o data URI segue com MIME de imagem, como as telas usam em <img>.
 * Roda com: node scripts/verificar-assinatura.mjs
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const temp = mkdtempSync(join(tmpdir(), 'assinatura-verify-'));
try {
  execSync(
    `pnpm exec tsc src/lib/assinatura.ts --outDir ${temp} --module commonjs --target es2020 --skipLibCheck`,
    { stdio: 'inherit' },
  );
  const require = createRequire(import.meta.url);
  const { renderizarAssinaturaSvg, assinaturaPngDataUri } = require(join(temp, 'assinatura.js'));

  const trajetoExemplo = '10,20;12,24;15,30;20,40;;30,50;34,54;40,60;;50,60;55,70;60,80';

  const r = renderizarAssinaturaSvg(trajetoExemplo);
  if (r.tracos !== 3) throw new Error(`esperava 3 traços, veio ${r.tracos}`);
  if (!/<path\s/.test(r.svg)) throw new Error('SVG sem <path> — assinatura sairia em branco');
  const qtdPaths = (r.svg.match(/<path\s/g) || []).length;
  if (qtdPaths !== 3) throw new Error(`esperava 3 <path>, veio ${qtdPaths}`);
  if (!r.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')) throw new Error('SVG sem xmlns');

  const png = assinaturaPngDataUri(trajetoExemplo);
  if (!png || !png.startsWith('data:image/svg+xml;base64,')) throw new Error('data URI inválido');
  const decodificado = Buffer.from(png.split(',')[1], 'base64').toString('utf8');
  if (decodificado !== r.svg) throw new Error('conteúdo base64 difere do SVG gerado');

  // Trajeto curto demais continua devolvendo null (telas mostram "assinatura registrada")
  if (assinaturaPngDataUri('10,20') !== null) throw new Error('trajeto curto deveria devolver null');

  console.log('assinatura ok —', qtdPaths, 'traços no SVG; data URI válido e decodificável');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
