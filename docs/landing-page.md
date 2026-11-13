<!-- â”€â”€ [PCODE-445 | S15 | v0.1.0] Landing page: fly through the real product, warmer sections â”€â”€ -->
<!-- â”€â”€ [PCODE-444 | S15 | v0.1.0] Landing page: smooth on integrated GPUs, footage and feature visuals â”€â”€ -->
<!-- â”€â”€ [PCODE-443 | S15 | v0.1.0] Cinematic landing page for the public site â”€â”€ -->

# The landing page

The front page of the public site (`index.html`), built by `npm run build -w @orqiva/site` like every
other page. The docs start at `overview.html`.

| Part                        | Where                                                        |
| --------------------------- | ------------------------------------------------------------ |
| Copy and structure          | `packages/site/src/landing.ts`                               |
| Styles                      | `packages/site/src/landingStyle.ts` â†’ `landing.css`        |
| The tour's 3D deck (CSS 3D) | `packages/site/client/deck.ts`                               |
| Scroll, demos, tracking     | `packages/site/client/landing.ts` â†’ `landing.js` (esbuild) |
| Screens, pictures, footage  | `packages/site/media/` â†’ `media/` on the site              |

## The story

The page shows the product itself. A tour through Orqiva's real screens takes one chapter per stage:
the home screen, ideation, the plan (Gantt), agents, tests, security, releases and the command center.
On wide screens the screens are a deck in 3D perspective that the camera moves through as the page
scrolls; the current one is in front with cards lifted off it that point at what matters, the next
ones wait behind it. A rail with the stage names, from idea to release, fills as the tour goes and
jumps on click. In the agents chapter, the Coder waits for the visitor's approval on a real card.

Below the tour: where it runs (over footage), the first hour (a timeline beside a terminal with the
real `orq install` output), the plans (cards from the shared offers), the questions (beside the real
inbox) and the final call to action (over footage). The page wears the product's palette from
`packages/web/src/theme.css` (dark): the indigo canvas, the indigoâ€“violetâ€“magenta band, coral, amber
and teal.

Every claim on the page comes from the docs it links to or is visible on the screens it describes.
Plan names, prices, what each plan includes, the free seats and the draft note come from `OFFERS` and
`PRICING_DRAFT` in `packages/shared/src/pricing.ts`, so the open owner decisions change the page by
themselves. The screens say "sample data".

## The screens

`media/screen-<name>.webp` (2000Ã—1250) are captures of the web app's own design preview
(`/preview`, no server, sample data), taken in English and dark mode with the preview's banner hidden:

| File                   | Preview route                   |
| ---------------------- | ------------------------------- |
| `screen-home.webp`     | `/preview`                      |
| `screen-ideation.webp` | `/preview/projects/PE/ideation` |
| `screen-canvas.webp`   | `/preview/projects/PE/canvas`   |
| `screen-agents.webp`   | `/preview/agents`               |
| `screen-test.webp`     | `/preview/projects/PE/test`     |
| `screen-security.webp` | `/preview/projects/PE/security` |
| `screen-releases.webp` | `/preview/releases`             |
| `screen-command.webp`  | `/preview/command`              |
| `screen-inbox.webp`    | `/preview/inbox`                |

To recapture after a design change: build the web app, serve `packages/web/dist` with a fallback to
`index.html`, set `localStorage` `orqiva.lang=en` and `pv-dark=1`, hide `.pv-banner`, and capture at
1600Ã—1000 with a device scale of 2. **One sample project carries the name of a real bank (KFW,
FÃ¶rderbank); remove it from the page before capturing.** A test checks that the landing page never
contains that name. A stop whose screen file is missing is left out of the tour; its chapter text
stays.

## Behaviour and fallbacks

<!-- â”€â”€ [PCODE-446 | S15 | v0.1.0] Landing page: one scroll step per chapter in the tour â”€â”€ -->

- **One step per input (wide screens):** in the tour, one wheel notch, ArrowDown/PageDown/Space or a
  stop on the rail glides exactly one chapter (ArrowUp/PageUp/Shift+Space one back), ending with the
  chapter centred and the deck on its screen (`client/steps.ts`). A trackpad gesture or a spinning
  wheel counts as one step. After the last chapter one more step glides to the next section; from the
  top of that section one step up leads back to the last chapter; further down the page scrolls
  normally. Keys in fields, and Space on buttons, links and questions, are left alone.
- **No JavaScript:** no deck; each chapter shows its screen beside its text, and every link and the
  questions work.
- **Phones (860 px and less):** the same, with the approval card inside the agents chapter.
- **Reduced motion:** the screens cross-fade in place instead of travelling; no parallax; the terminal
  shows all lines at once; footage does not play.
- **Performance:** the deck changes only `transform` and `opacity`, writes a style only when it
  changed, renders only while the tour is on screen and the tab is visible, and stops when it has
  settled. On the Intel UHD 630 over a 32 Hz remote desktop no frame is dropped while scrolling.
- **Save-Data:** no footage.
- The script is one module file from the site itself; there is no inline script and no inline style,
  so the strict Content Security Policy of the server applies unchanged.

## Events

The page reports what visitors do as a DOM event and, if a tag manager created one, on
`window.dataLayer`. The site has no analytics of its own: without a listener nothing leaves the
browser.

```js
window.addEventListener('orqiva:track', (e) => console.log(e.detail)); // { event, ...fields }
```

| Event                                                                                           | When                                                          | Fields               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | -------------------- |
| `nav_install`, `hero_install`, `plans_install`, `start_install`, `final_install`                | An install button (top bar, hero, free plan, first hour, end) | `href`               |
| `install_start`                                                                                 | Any click into `getting-started.html` (sign-up start)         | `from` (event above) |
| `hero_tour`                                                                                     | "Take the tour"                                               | `href`               |
| `rail_jump`                                                                                     | A stop on the tour's rail                                     | `href`               |
| `chapter_doc`, `section_doc`, `section_pricing`, `plans_compare`, `start_migrate`, `final_docs` | Links to the docs                                             | `href`               |
| `tour_start`                                                                                    | The 3D deck started (once, wide screens)                      | `reducedMotion`      |
| `chapter_view`                                                                                  | A chapter reaches the middle of the screen (once each)        | `chapter`            |
| `scroll_depth`                                                                                  | 25, 50, 75 and 100 % of the page                              | `percent`            |
| `demo_approve`, `demo_hold`                                                                     | Approve or Not now on the Coder's card                        |                      |
| `demo_decision`                                                                                 | After either (once)                                           | `approved`           |
| `terminal_view`                                                                                 | The install terminal came into view (once)                    |                      |
| `copy_command`                                                                                  | The first install command was copied                          |                      |
| `faq_open`                                                                                      | A question was opened (once each)                             | `question`           |

Sign-up completion happens on each customer's own server (the first account), which the public site
cannot see. For a funnel, count `install_start` here against downloads of `orq.mjs` and, after launch,
licence orders on the vendor server.

## Pictures and footage

| Files                                               | Where it shows                                         |
| --------------------------------------------------- | ------------------------------------------------------ |
| `hero.webp`, `feature-<chapter>.webp`, `owned.webp` | Soft backdrops behind the tour's screens, one per stop |
| `owned.webp` (1920Ã—1086), `owned.webm`             | Behind "All of it stays inside your walls"             |
| `hero.webp` (1920Ã—1086), `hero.webm`               | Behind the final call to action                        |
| `og.jpg` (1200Ã—630)                                | Link previews (`og:image`)                             |

These were made with Higgsfield on 18 Oct 2026: the stills with GPT Image 2.5, the loops with Wan 3.0
from the two stills as first frames (1080p, 8 s, silent), re-encoded to 1280Ã—720 WebM (VP8) with the
last second cross-faded into the first, so they loop without a seam. The prompts are in the PCODE-444
note. A loop loads only when its section comes near the screen, never with reduced motion or
Save-Data, and the still stays when autoplay is refused.

<!-- â”€â”€ [PCODE-447 | S15 | v0.1.0] Serve the public site from Docker Desktop for outside review â”€â”€ -->

## A review copy on Docker Desktop

`deploy/site/compose.yaml` serves the built site (landing page and docs) from an nginx container,
`orqiva-site`, on port 8088 (`ORQIVA_SITE_PORT` to change it). The site is mounted read-only from
`out/site`, so a rebuild shows at once:

```
npm run build -w @orqiva/site   # build the site into out/site
npm run site:up                 # start (restarts with Docker unless stopped)
npm run site:down               # stop and remove
```

`deploy/site/nginx.conf` sends the headers the product promises: a Content Security Policy with
scripts only from the site and no framing, `nosniff`, `X-Frame-Options: DENY`, no referrer. HTML is
revalidated on every visit; scripts and styles (named by their content hash) and media are cached.

On the build machine the site answers on `http://<its public address>:8088/`. It is public there:
anyone who knows the address can open it. Stop it with `npm run site:down` when the review is over.

<!-- â”€â”€ [PCODE-449 | S15 | v0.1.0] Landing page: the product tour as real video of Orqiva in use â”€â”€ -->

## The product in use (clips)

Each tour stop plays a short recording of the product in use over its screen (`media/clip-<screen>.webm`,
1600Ã—1000, VP8, 10â€“16 s, about 1 MB each): a scripted person working in the web app's `/preview`
with a visible cursor. Home: a decision in the inbox is approved. Ideation: requirements, open
questions and an answer to the Analyst. Plan: a task, the Gantt by weeks, the workload. Agents: runs,
traces, costs. Tests: the failed step retested, its recording, sign-off. Security: findings opened one
after another. Release: the train and its changelog. Command center: the replay scrubbed through the
day.

- In the deck only the screen in front plays, from its start; the next clip is fetched ahead. On
  phones a clip plays while half of it is in view. Nothing loads before it is needed.
- **Pause the screens** (bottom right of the tour) pauses every clip and both background films; the
  choice is kept for the visitor (`localStorage` `orqiva.motion`). With Save-Data they start paused.
  Reduced motion does not stop the clips (they are the page's content), but the camera cross-fades
  instead of travelling.
- To record again: `deploy/site/tools/` (`serve-preview.mjs`, then `record-clips.mjs` or `capture-screens.mjs`): it
  drives Chromium, captures Chrome's screencast, resamples it to 25 fps and encodes it with
  Playwright's ffmpeg. It hides the sample project that names a real bank in every frame.

<!-- ── [PCODE-451 | S15 | v0.1.0] Landing page: steady server-room loop, 3D Orqiva mark in the finale ── -->

## The finale and the server room (since PCODE-451)

- **Finale:** the Orqiva mark as a real-time 3D object (`client/mark3d.ts`, WebGL2, our own code): a
  torus in the mark's indigo → violet → magenta, thickest at the lower left, with the coral node riding
  it through a gap. When the section comes into view the ring turns in from edge-on, the node sets
  off and the name "Orqiva" assembles letter by letter. It follows the pointer, renders only on
  screen, holds its finished frame when the screens are paused or with reduced motion, and shows
  `logo.svg` without WebGL2. An AI video was not used: video models distort logos and lettering.
- **Server room:** regenerated with Wan 3.0 from the same first frame with the camera locked off; two
  variants, the steadier kept (edge shift between 1 s and 6.7 s: 3.8, against 27.6 for the zooming
  first version). Only light moves. The light-line film (`hero.webm`) is gone; `hero.webp` remains
  as the tour's first backdrop.

<!-- ── [PCODE-452 | S15 | v0.1.0] Landing page: cinematic arrival of the 3D mark, framed and timed ── -->

### The finale's arrival (since PCODE-452)

It begins when the mark is 90 % in view and is timed from that moment: 0–0.9 s the ring fades up out
of darkness, far and edge-on; 0.15–3.35 s one long ease-in-out turn to face the visitor, with a roll
unwinding and a dolly forward; 2.3–3 s the coral node pops onto the ring with a glow flash; 2.6–3.8 s
one glint across the surface (again every 7 s); from 3.2 s the orbit and a slow breath ease in. The
name rises letter by letter from 2.9 s, the headline from 3.7 s, the buttons from 3.95 s. The camera
stands back so the ring fills about two thirds of its stage and never touches the edge. The text uses
keyframe animations, not transitions: a transition is skipped when the browser never computed the
hidden state, so the name sometimes simply appeared.
