// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
//    Why:  imported first, so every module that reads ORQIVA_* at load time already sees the values of
//          PRODENGINE_* variables set before the rename.
import { applyLegacyEnv } from '@orqiva/shared';

applyLegacyEnv();
