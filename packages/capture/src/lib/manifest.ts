// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  one extension, two manifests. Chrome runs the background as a service worker; Firefox as an
//          event script and needs its add-on id. Both run the page hook in the page's own world (it sees
//          the page's console and fetch) and the collector beside it, from the start of every page.

export type Browser = 'chrome' | 'firefox';

export function manifestFor(browser: Browser, version: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: 'Orqiva bug capture',
    short_name: 'Orqiva capture',
    version,
    description:
      'File a bug to Orqiva with a screenshot, the console, the network and the steps before it.',
    icons: { '16': 'icon.png', '48': 'icon.png', '128': 'icon.png' },
    action: { default_title: 'File a bug to Orqiva', default_popup: 'popup.html' },
    options_ui: { page: 'options.html', open_in_tab: true },
    permissions: ['activeTab', 'storage'],
    host_permissions: ['<all_urls>'],
    background:
      browser === 'chrome' ? { service_worker: 'background.js' } : { scripts: ['background.js'] },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['page.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: false,
      },
      { matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start', all_frames: false },
    ],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            // the page-world content script needs Firefox 128
            gecko: { id: 'capture@orqiva.app', strict_min_version: '128.0' },
          },
        }
      : { minimum_chrome_version: '111' }),
  };
}
