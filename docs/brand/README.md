<!-- ── [PCODE-448 | S15 | v0.1.0] Orqiva logo on the public site ── -->

# The Orqiva mark

An O drawn as one orbit that flows indigo → violet → magenta, with a single coral node riding it: a
system in motion with one point of attention, the person who approves. It is a square, transparent
SVG of about 2 KB that stays sharp from a 16 px favicon up.

- **In use:** `packages/site/src/logo.ts` (`LOGO_SVG`). The site writes it as `logo.svg` and
  `favicon.svg`; the landing page shows it in the bar and the footer, the docs in their top bar. The
  link preview `packages/site/media/og.jpg` carries it with the wordmark.
- **Colours:** `#3f2ad8` indigo, `#7651ed` violet, `#5e159d` and `#a22bb1` magenta, `#fe645f` coral.
  The darkest indigo was lifted from the generated `#27089b` so the mark reads on dark backgrounds.
- **Wordmark:** "Orqiva" set in the site's display face (Segoe UI Variable Display / SF Pro Display),
  semibold, tight tracking, beside the mark at about the mark's height.
- **Origin:** made with Higgsfield (Recraft V4.1, vector) on 18 Oct 2026 from six concepts, kept in
  `logo-concepts/` as generated (with their content credentials): A orbit O (chosen), B line O, C
  command dial, D key O (runner-up), E two rings, F stacked screens. `overview.png` compares them on
  dark and light and at 32 and 16 px.
- **Not yet changed:** the web app's own icon (`packages/web/icons.mjs`) still shows the old "P"
  from the ProdEngine name; switching it to this mark is a separate task.
