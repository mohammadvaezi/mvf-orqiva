// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
import { PLATFORM_VERSION, PRODUCT_NAME } from '@orqiva/shared';

/** The window title: product and version, so a screenshot always says which build it shows. */
export function appTitle(): string {
  return PRODUCT_NAME + ' ' + PLATFORM_VERSION;
}
