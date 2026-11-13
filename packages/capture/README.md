<!-- [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox -->

# Orqiva bug capture

A browser extension for Chrome, Edge and Firefox. It files a bug to an Orqiva project with what the
person saw and did:

- a screenshot of the visible tab;
- the last console messages and errors;
- the last network requests (method, address, status, time);
- the last actions: clicks, typing (never the text), submits, keys and navigation;
- the page, the browser, the window and screen sizes, the language and the time zone;
- a screen recording, if one was made for it.

Personal data in the report is masked on the server, as in test results.

## Build

```
npm run build -w packages/capture
```

This makes `dist/chrome` (Chrome and Edge, Manifest V3 service worker) and `dist/firefox` (Firefox 128
or later, background script, add-on id `capture@orqiva.app`).

## Install for testing

- Chrome or Edge: open `chrome://extensions` (or `edge://extensions`), switch on developer mode, choose
  **Load unpacked** and pick `dist/chrome`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on** and pick
  `dist/firefox/manifest.json`.

Then open the extension's options. Enter the Orqiva server's address and a personal API token (in Orqiva:
Settings → API tokens). The token stays in the browser's extension storage.

## Use

Click the extension's button on the page with the bug. Pick the project, give it a title and a note,
choose what goes with it, and choose **File the bug**. The answer has the bug's reference and a link.
**Record the screen** opens a tab that records a tab, a window or the screen for up to two minutes; the
recording goes with the next bug filed to that project.

Pages the browser does not let extensions enter (its own settings, the extension stores) are filed with
the page address and the screenshot only.
