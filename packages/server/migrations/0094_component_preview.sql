-- ── [PCODE-291 | S15 | v0.1.0] T30.5 Live component preview with the project's tokens and themes ──
-- Why:  a component's example markup and CSS, shown live with the project's tokens.

ALTER TABLE ui_components
  ADD COLUMN preview_html text NOT NULL DEFAULT '' CHECK (length(preview_html) <= 20000),
  ADD COLUMN preview_css  text NOT NULL DEFAULT '' CHECK (length(preview_css) <= 20000);
