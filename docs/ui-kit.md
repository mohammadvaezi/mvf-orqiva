<!-- [PCODE-298 | S15 | v0.1.0] T30.11 T30 exit check, docs and sprint close -->

# UI kit and design

Every project has a **UI kit** tab: **Mockups**, **Brand**, **Tokens**, **Components**, **Assets**, **Checks**
and **Visual**. The kit is where design and code meet: designers put the look in, developers and agents take
it out, and the checks show where the two have drifted apart.

## Tokens, themes and modes

A token is a named value: `color.primary`, `space.4`, `font.weight.bold`. Each has a light value, a dark value
when it differs, and a value for every **theme** that needs its own (a theme starts from light or dark and
changes only what it names). A value can point at another token, written `{color.primary}`; the tab warns
about aliases that lead nowhere or in a circle.

**Import W3C tokens** reads a W3C design tokens file, and the files Tokens Studio and Figma write; it shows
what would be added and changed before anything is. **Download as** gives the tokens as CSS variables,
Tailwind, TypeScript, W3C tokens, iOS (Swift, with a colour per theme) and Android (resource folders for day,
night and each theme, as a ZIP). **Open a pull request** writes the chosen formats into a repository on a new
branch (GitHub or Gitea, once an admin gave the connection an API token), and only the files that changed.

The **Checks** tab shows the contrast of text colours on backgrounds in every mode and theme, graded AA and
AAA.

## Figma

An admin links the project's Figma file under **Tokens**: the file's link and an access token, kept sealed and
never shown again. **Check Figma** reads the file's variables and compares them with the tokens three ways:
what Figma has, what Orqiva has, and what both had at the last sync.

- **Waiting from Figma**: changed by a designer only. Tick what to take.
- **To send to Figma**: changed here only. Sending writes Figma's variables in one request.
- **Changed on both sides**: pick Figma, here, or leave it for later.

Variable modes become light, dark and themes (a mode Orqiva does not know becomes a theme when taken);
colours, numbers, font weights and families and durations are synced, true/false variables are not. Taking
and sending read Figma again first, so a decision never acts on an old comparison. The same check links
each component of the inventory to the Figma component (or variant set) of its name. Figma's variables API
needs a Figma Enterprise plan and a token that may read (and, to send, write) file variables.

## Brand

**Brand** is the brand book: an overview, colour, type, voice and logo use, each written in Markdown. Colour and
type come from the tokens as they are now, and logos from the assets. **Do** and **don't** examples carry a
picture each. **Download the brand book** gives one HTML file with its pictures inside, to send anywhere.

## Components and the code

**Components** is the inventory: name, status, where it lives in the code, its props and its design. `orq kit
scan` reads every UI file Git tracks and counts where each component is used (its own file does not count),
and finds colours and sizes written by hand, naming the token with the same value; the result shows here and
under **Checks**. `orq kit check` lists those values in the files changed now, and `orq done` warns about them
in a task's files.

**Preview** shows a component as it is meant to look: an example of markup and CSS on a page of its own that
carries the project's tokens, in light, dark or any theme. The page is inert: scripts, frames, forms and
outside addresses are taken out, and it runs in a sandbox.

Developer, architect, reviewer and tester agents get the **kit rule** with every UI task: the tokens and
components to use, the deprecated ones to avoid, and the accessibility rules below.

## Mockups, review and handoff

**Mockups** are reviewed version by version. Click on the image to pin a comment to that spot; approve the
current version or ask for changes. Two versions compare side by side, as an **overlay** with a slider, with a
**swipe**, or as a **difference** where only what changed lights up.

**Share with the client** puts a mockup in the client portal for approval with a signature. The client's
contacts can look at it closely and pin comments to it there; the team sees those pins marked as from the
client, and a task the design belongs to says so in its history.

**Handoff** is the spec a version is built from: the tokens and components it uses, its states and breakpoints,
distances measured on the image (two clicks; each shows its pixels and the spacing token it matches) and the
areas to export as assets. A new version shows the last spec until it gets its own. The spec downloads as
Markdown or JSON, for a developer or an agent. **Make assets** cuts the export areas out of the image and adds
them to **Assets** with their sizes (the image counts as the largest scale).

## Assets and the download portal

**Assets** keeps logos, icons, images and fonts with their licence, where they may be used and when the rights
end. **Sizes** makes the files a platform asks for from one source: scales 1x to 3x, web widths, the iOS and
Android app icons, favicons and social images, in PNG, WebP or JPEG. A picture is never enlarged; an SVG draws
sharp at any size. Each asset downloads as a ZIP with its sizes and a RIGHTS.txt.

**Offer in the client portal** puts an asset in the portal's **Assets** section, where the client downloads it,
its sizes, or everything as one ZIP. An asset whose rights have ended is never offered.

## Visual checks

**Visual** keeps an approved screenshot (the baseline) of each screen and compares every new one with it pixel
by pixel. In CI, after the screenshots are taken:

```
orq visual check shots/*.png
```

Each PNG's file name is its screen's name (or give `--name`), and the commit is recorded. A screen passes when
no more than its allowed share of pixels changed (0.1 % unless set otherwise); otherwise it fails and the step
fails. A screen seen the first time waits for a baseline. The tab shows failing screens first, with the diff
image (what changed in red), side by side, overlay, swipe or difference, and **Approve the change** when it was
meant. A screen linked to its mockup can be held against the design.

## Accessibility

Two checks, both shown under **Checks**:

- **In the code**: `orq a11y check` (changed files) and `orq a11y scan` (all, sent to Orqiva) find images
  without alt text or with a file name for one, buttons and links without a name, clicks on elements the
  keyboard cannot reach, positive tabindex, fields without a label, focus styles that remove the outline and
  buttons styled under 24 px. A line with `a11y-ignore` is skipped; `orq done` warns about the task's files.
- **On the page**: `orq a11y script` prints an audit for a browser. CI runs it on each page after it loaded,
  saves what it returns, and sends it with `orq a11y report FILE.json --name SCREEN`. It measures real target
  sizes (24 × 24 px, or no other target within 24 px), walks the focus order as Tab does, focuses each element
  to see that a focus mark shows, and checks alt text, names and labels.

## Limits

- Asset sizes are drawn in the browser; the API keeps sizes but does not make them.
- Visual checks read PNG screenshots; Orqiva does not take them itself.
- Figma is read when someone checks; changes in Figma do not start a check by themselves yet.
- A component's preview is an example of markup and CSS, not the component's own code.
