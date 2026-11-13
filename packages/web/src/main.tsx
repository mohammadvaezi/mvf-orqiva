// ── [PCODE-356 | S15 | v0.1.0] T35.5a Translation layer for a German UI, language choice, text extraction ──
// ── [PCODE-151 | S15 | v0.1.0] Make the web app an installable PWA with Web Push ──
// ── [PCODE-84 | S08 | v0.1.0] Set up the platform monorepo with npm workspaces, own build scripts and CI ──
// ── [PCODE-90 | S15 | v0.1.0] Build the web app shell with login and the ported design system ──
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import { registerServiceWorker } from './pwa.js';
import { applyTheme, storedTheme } from './core/theme.js';
import { applyLanguage, chooseLanguage, storedLanguage } from './i18n/language.js'; // [PCODE-356 | S15 | v0.1.0]
import './theme.css';

applyTheme(storedTheme());
// [PCODE-356 | S15 | v0.1.0] the language of the last visit, else the browser's
void applyLanguage(chooseLanguage({ stored: storedLanguage(), browser: navigator.language }));
// [PCODE-151 | S15 | v0.1.0] installable, with the shell kept for offline use
registerServiceWorker();
const root = document.getElementById('app');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
