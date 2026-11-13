// ── [PCODE-320 | S15 | v0.1.0] T32.5b The bug-capture browser extension for Chrome and Firefox ──
//    Why:  some bugs need to be seen moving. The person picks a tab, window or screen, records up to two
//          minutes, and the video is uploaded to the project and goes with their next bug.
import { ext } from './ext.js';
import { makeClient, type Settings } from './lib/client.js';

const LIMIT_MS = 120_000;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the caller names the element's kind
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('missing #' + id);
  return el as T;
};
const say = (t: string): void => {
  $('status').textContent = t;
};

let recorder: MediaRecorder | null = null;

async function record(): Promise<void> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch {
    say('Nothing was shared, so nothing is recorded.');
    return;
  }
  const chunks: Blob[] = [];
  recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  recorder.onstop = () => {
    for (const t of stream.getTracks()) t.stop();
    void upload(new Blob(chunks, { type: 'video/webm' }));
  };
  recorder.start(1000);
  $<HTMLButtonElement>('start').disabled = true;
  $<HTMLButtonElement>('stop').disabled = false;
  say('Recording… (at most two minutes)');
  setTimeout(() => {
    if (recorder?.state === 'recording') recorder.stop();
  }, LIMIT_MS);
  // stopping the share in the browser's own bar ends the recording too
  stream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (recorder?.state === 'recording') recorder.stop();
  });
}

async function upload(video: Blob): Promise<void> {
  $<HTMLButtonElement>('stop').disabled = true;
  say('Uploading the recording…');
  const stored = await ext.storage.local.get(['settings', 'recordFor']);
  const settings = stored['settings'] as Settings | undefined;
  const projectId = stored['recordFor'];
  if (!settings?.token || typeof projectId !== 'string' || !projectId) {
    say('Connect in the options and pick a project in the popup first.');
    return;
  }
  try {
    const fileId = await makeClient(settings).upload(
      projectId,
      'recording.webm',
      'video/webm',
      new Uint8Array(await video.arrayBuffer()),
    );
    await ext.storage.local.set({ recording: { fileId, projectId, at: new Date().toISOString() } });
    say('The recording goes with your next bug. You can close this tab.');
  } catch (e) {
    say(e instanceof Error ? e.message : 'The recording was not uploaded');
  }
}

$('start').addEventListener('click', () => {
  void record();
});
$('stop').addEventListener('click', () => {
  if (recorder?.state === 'recording') recorder.stop();
});
