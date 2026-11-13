// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  filing the bug happens here, outside the page: the screenshot of the visible tab, what the
//          collector kept, the recording waiting to go with the next bug, uploaded and sent to the
//          person's own server with their token. The popup only asks and shows the answer.
import { ext } from './ext.js';
import type { Collected } from './lib/collect.js';
import {
  CaptureError,
  dataUrlBytes,
  makeClient,
  reportBody,
  type Include,
  type Settings,
} from './lib/client.js';

export interface FileRequest {
  type: 'file';
  projectId: string;
  title: string;
  note: string;
  screenshot: boolean;
  include: Include;
  /** the page's tab, as the popup saw it when it opened; else the active tab */
  tabId?: number;
}
export type FileAnswer = { ok: true; ref: string; url: string } | { ok: false; error: string };

async function fileBug(r: FileRequest): Promise<FileAnswer> {
  const stored = await ext.storage.local.get(['settings', 'recording']);
  const settings = stored['settings'] as Settings | undefined;
  if (!settings?.token)
    return { ok: false, error: 'Connect to your Orqiva server in the options first' };
  const tabs = await ext.tabs.query({ active: true, currentWindow: true });
  const tab =
    r.tabId === undefined
      ? tabs[0]
      : ((await ext.tabs.get(r.tabId).catch(() => undefined)) ?? tabs[0]);
  if (tab?.id === undefined) return { ok: false, error: 'No page to capture' };
  let collected: Collected;
  try {
    collected = (await ext.tabs.sendMessage(tab.id, { type: 'collect' })) as Collected;
  } catch {
    // a page the extension cannot enter (the browser's own pages, the web store): what the tab says
    collected = {
      page: { url: tab.url ?? '', title: tab.title ?? '' },
      device: {
        userAgent: navigator.userAgent,
        platform: '',
        language: navigator.language,
        viewport: { width: 0, height: 0 },
        screen: { width: 0, height: 0, pixelRatio: 1 },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      console: [],
      network: [],
      actions: [],
    };
  }
  const client = makeClient(settings);
  try {
    let screenshotFileId: string | undefined;
    if (r.screenshot) {
      const png = dataUrlBytes(await ext.tabs.captureVisibleTab(tab.windowId, { format: 'png' }));
      screenshotFileId = await client.upload(r.projectId, 'screenshot.png', png.mime, png.data);
    }
    const rec = stored['recording'] as { fileId: string; projectId: string } | undefined;
    const recordingFileId = rec?.projectId === r.projectId ? rec.fileId : undefined;
    const made = await client.fileBug(
      r.projectId,
      reportBody(r.title, r.note, collected, r.include, {
        ...(screenshotFileId ? { screenshotFileId } : {}),
        ...(recordingFileId ? { recordingFileId } : {}),
      }),
    );
    if (recordingFileId) await ext.storage.local.remove(['recording']);
    await ext.storage.local.set({ lastProjectId: r.projectId });
    return { ok: true, ...made };
  } catch (e) {
    return { ok: false, error: e instanceof CaptureError ? e.message : 'The bug was not filed' };
  }
}

ext.runtime.onMessage.addListener((message, _sender, reply) => {
  if ((message as { type?: string } | null)?.type !== 'file') return undefined;
  void fileBug(message as FileRequest).then(reply);
  return true;
});
