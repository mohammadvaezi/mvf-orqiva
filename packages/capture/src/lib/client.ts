// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  the extension talks to the person's own Orqiva server with their personal API token: who they
//          are and which projects they may file into, uploading the screenshot or the recording, and
//          filing the bug. The report keeps only the parts the person left switched on.
import type { Collected } from './collect.js';

export interface Settings {
  server: string;
  token: string;
  workspaceId: string;
}

export class CaptureError extends Error {}

export interface Client {
  me(): Promise<{ name: string; workspaces: { id: string; name: string }[] }>;
  projects(): Promise<{ id: string; key: string; name: string }[]>;
  upload(
    projectId: string,
    name: string,
    mime: string,
    data: Uint8Array<ArrayBuffer>,
  ): Promise<string>;
  fileBug(projectId: string, body: Record<string, unknown>): Promise<{ ref: string; url: string }>;
}

/** The server's address without a slash at the end; https, or http on this machine only. */
export function serverUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  return u.origin + u.pathname.replace(/\/+$/, '');
}

export function makeClient(s: Settings, fetchImpl: typeof fetch = fetch): Client {
  const call = async <T>(
    method: string,
    path: string,
    body?: BodyInit,
    type?: string,
  ): Promise<T> => {
    let res: Response;
    try {
      res = await fetchImpl(s.server + path, {
        method,
        headers: {
          authorization: 'Bearer ' + s.token,
          ...(type ? { 'content-type': type } : {}),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch {
      throw new CaptureError('Cannot reach ' + s.server);
    }
    const text = await res.text();
    const json = (text ? JSON.parse(text) : {}) as T & { error?: { message?: string } };
    if (!res.ok)
      throw new CaptureError(
        res.status === 401
          ? 'The token was not accepted; check it in the options'
          : (json.error?.message ?? 'The server answered ' + String(res.status)),
      );
    return json;
  };
  const W = '/api/workspaces/' + s.workspaceId;
  return {
    me: () =>
      call<{ user?: { name: string }; name?: string; workspaces: { id: string; name: string }[] }>(
        'GET',
        '/auth/me',
      ).then((m) => ({ name: m.user?.name ?? m.name ?? '', workspaces: m.workspaces })),
    projects: () => call<{ id: string; key: string; name: string }[]>('GET', W + '/projects'),
    upload: async (projectId, name, mime, data) =>
      (
        await call<{ id: string }>(
          'POST',
          W + '/files?name=' + encodeURIComponent(name) + '&projectId=' + projectId + '&read=0',
          new Blob([data], { type: mime }),
          mime,
        )
      ).id,
    fileBug: async (projectId, body) => {
      const r = await call<{ ref: string; url: string }>(
        'POST',
        W + '/projects/' + projectId + '/bug-reports',
        JSON.stringify(body),
        'application/json',
      );
      return { ref: r.ref, url: s.server + r.url };
    },
  };
}

/** A data: URL's bytes (the screenshot the browser gives). */
export function dataUrlBytes(url: string): { mime: string; data: Uint8Array<ArrayBuffer> } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new CaptureError('Not a data address');
  const raw = m[2] ? atob(m[3] ?? '') : decodeURIComponent(m[3] ?? '');
  const data = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
  return { mime: m[1] ?? 'application/octet-stream', data };
}

export interface Include {
  console: boolean;
  network: boolean;
  actions: boolean;
}

/** The report the server takes, with the parts switched off left empty. */
export function reportBody(
  title: string,
  note: string,
  c: Collected,
  include: Include,
  files: { screenshotFileId?: string; recordingFileId?: string },
): Record<string, unknown> {
  return {
    title: title.trim().slice(0, 255),
    note: note.trim(),
    page: { url: c.page.url.slice(0, 2000), title: c.page.title.slice(0, 500) },
    device: c.device,
    console: include.console ? c.console.slice(-200) : [],
    network: include.network ? c.network.slice(-200) : [],
    actions: include.actions ? c.actions.slice(-100) : [],
    ...(files.screenshotFileId ? { screenshotFileId: files.screenshotFileId } : {}),
    ...(files.recordingFileId ? { recordingFileId: files.recordingFileId } : {}),
  };
}
