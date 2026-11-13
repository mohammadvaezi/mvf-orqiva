// ── [PCODE-420 | S15 | v0.1.0] T37 medium: English screens use English number and date formats ──
// ── [PCODE-272 | S15 | v0.1.0] T28.1 Ideation intake: links read on the server, sources from the CLI and VS Code ──
// ── [PCODE-242 | S15 | v0.1.0] T24.3 AI providers and file reading in the web app ──
// ── [PCODE-235 | S15 | v0.1.0] T23.2 Messages in the web app ──
// ── [PCODE-170 | S15 | v0.1.0] B3.3 Ideation live in the web app: ideas list, interview with coverage, sources, requirements, questions, risks, priority, decisions ──
//    Why:  one way to upload for every tab (idea sources, documents, mockups, assets): the file's bytes as
//          the request body, its name and project in the address, the answer read like any API answer.
import type { ApiResult } from '../core/api.js';
import { fmtLocale } from '../core/locale.js'; // [PCODE-420 | S15 | v0.1.0]

export interface UploadedFile {
  id: string;
  projectId: string | null;
  name: string;
  mime: string;
  sizeBytes: number;
  sha256: string;
  hasText: boolean;
  url: string;
}

/** [PCODE-242 | S15 | v0.1.0] What a file's read says to people, and whether it is still going on. */
export function readText(read: { status: string; error: string } | null | undefined): {
  text: string;
  pending: boolean;
  failed: boolean;
} {
  if (!read) return { text: '', pending: false, failed: false };
  if (read.status === 'queued' || read.status === 'reading')
    return { text: 'being read by the Reader', pending: true, failed: false };
  if (read.status === 'failed' || read.status === 'skipped')
    return { text: 'not read: ' + read.error, pending: false, failed: true };
  return { text: '', pending: false, failed: false };
}

// [PCODE-272 | S15 | v0.1.0]
/** What a link's read says to people: failed with why, or still going on. */
export function linkText(link: { status: string; error: string } | null | undefined): {
  text: string;
  failed: boolean;
} {
  if (!link) return { text: '', failed: false };
  if (link.status === 'reading') return { text: 'being read', failed: false };
  if (link.status === 'failed') return { text: 'not read: ' + link.error, failed: true };
  return { text: '', failed: false };
}

/** "S2" or "S2, S3 and S5" */
export const labelsText = (labels: readonly string[]): string =>
  labels.length < 2
    ? (labels[0] ?? '')
    : labels.slice(0, -1).join(', ') + ' and ' + String(labels.at(-1));

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export async function uploadFile(
  workspaceId: string,
  /** [PCODE-235 | S15 | v0.1.0] null: a file of the workspace (a message's attachment) */
  projectId: string | null,
  file: File,
  fetchImpl: typeof fetch = fetch,
): Promise<ApiResult<UploadedFile>> {
  if (file.size > MAX_UPLOAD_BYTES)
    return {
      ok: false,
      error: {
        status: 413,
        code: 'payload_too_large',
        message: file.name + ' is larger than 25 MB.',
        details: [],
      },
    };
  try {
    const res = await fetchImpl(
      '/api/workspaces/' +
        workspaceId +
        '/files?' +
        (projectId ? 'projectId=' + projectId + '&' : '') +
        'name=' +
        encodeURIComponent(file.name),
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': file.type || 'application/octet-stream' },
        body: file,
      },
    );
    const json = (await res.json().catch(() => undefined)) as
      (UploadedFile & { error?: { code?: string; message?: string } }) | undefined;
    if (res.ok && json) return { ok: true, data: json };
    return {
      ok: false,
      error: {
        status: res.status,
        code: json?.error?.code ?? 'internal',
        message: json?.error?.message ?? 'The upload failed (' + String(res.status) + ').',
        details: [],
      },
    };
  } catch {
    return {
      ok: false,
      error: {
        status: 0,
        code: 'network',
        message: 'Cannot reach the server. Check the connection and try again.',
        details: [],
      },
    };
  }
}

/** 1.2 MB, 340 KB, 12 B: sizes the German way. */
export const sizeText = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? (bytes / 1024 / 1024).toLocaleString(fmtLocale(), { maximumFractionDigits: 1 }) + ' MB'
    : bytes >= 1024
      ? String(Math.round(bytes / 1024)) + ' KB'
      : String(bytes) + ' B';
