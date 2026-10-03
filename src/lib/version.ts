/**
 * ─────────────────────────────────────────────────────────────────────────────
 * VERSÃO OFICIAL DO SISTEMA — fonte única de verdade
 * ─────────────────────────────────────────────────────────────────────────────
 * Regras de versionamento (SemVer):
 *  - PATCH  (1.0.X): correções de bugs, ajustes visuais pontuais, melhorias internas.
 *  - MINOR  (1.X.0): nova funcionalidade, nova tela, novo recurso relevante.
 *  - MAJOR  (X.0.0): reformulação estrutural grande / mudança incompatível.
 *
 * Toda implementação relevante ATUALIZA A VERSÃO UMA ÚNICA VEZ (por tarefa) e
 * registra a entrada correspondente em src/components/changelog.ts.
 * Qualquer tela que precise exibir a versão importa daqui — nunca hardcode.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const APP_VERSION = '1.6.2';

export const APP_RELEASE_DATE = '2026-10-03';

export function versionLabel(): string {
  return `v${APP_VERSION}`;
}
