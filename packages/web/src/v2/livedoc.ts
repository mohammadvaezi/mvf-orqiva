// ── [PCODE-282 | S15 | v0.1.0] T29.4 Live co-editing of documents with our own three-way merge ──
//    Why:  the editor's side of a live draft: join it, send the text about every second with the
//          revision last seen, take the merged answer, and when the answer crosses
//          new typing, merge again here so nothing typed meanwhile is lost. Saving makes the draft the
//          page's next version; leaving tells the others.
import { merge3 } from '@orqiva/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../core/api.js';

export interface LiveAnswer {
  rev: number;
  title: string;
  body: string;
  baseVersion: number;
  conflicts: number;
  editors: { userId: string; name: string }[];
}

/** The text to show when an answer arrives: the answer, or the answer merged with what was typed meanwhile. */
export function rebase(
  sent: { title: string; body: string },
  now: { title: string; body: string },
  answer: { title: string; body: string },
): { title: string; body: string; conflicts: number } {
  if (now.body === sent.body && now.title === sent.title)
    return { title: answer.title, body: answer.body, conflicts: 0 };
  const m = merge3(sent.body, now.body, answer.body);
  return {
    title: now.title !== sent.title ? now.title : answer.title,
    body: m.text,
    conflicts: m.conflicts,
  };
}

export type LiveState = 'joining' | 'live' | 'closed' | 'error';

/** What the page editor works with. */
export interface LiveDoc {
  state: LiveState;
  title: string;
  body: string;
  setTitle: (t: string) => void;
  setBody: (b: string) => void;
  others: string[];
  conflicts: number;
  message: string;
  save: () => Promise<number | null>;
}

export function useLiveDoc(
  workspaceId: string,
  pageId: string,
  active: boolean,
  meId: string,
): LiveDoc {
  const D = (p: string): string =>
    '/api/workspaces/' + workspaceId + '/docs/' + pageId + '/live' + p;
  const [state, setState] = useState<LiveState>('joining');
  const [title, setTitleState] = useState('');
  const [body, setBodyState] = useState('');
  const [others, setOthers] = useState<string[]>([]);
  const [conflicts, setConflicts] = useState(0);
  const [message, setMessage] = useState('');
  const now = useRef({ title: '', body: '' });
  const synced = useRef<{ rev: number; title: string; body: string } | null>(null);
  const busy = useRef(false);

  const apply = useCallback((t: string, b: string) => {
    now.current = { title: t, body: b };
    setTitleState(t);
    setBodyState(b);
  }, []);
  const take = useCallback(
    (r: LiveAnswer) => {
      setOthers(r.editors.filter((e) => e.userId !== meId).map((e) => e.name));
      if (r.conflicts) setConflicts((n) => n + r.conflicts);
    },
    [meId],
  );

  const sync = useCallback(async (): Promise<void> => {
    const from = synced.current;
    if (!from || busy.current) return;
    busy.current = true;
    const sent = { ...now.current };
    const r = await api<LiveAnswer>('POST', D('/sync'), {
      rev: from.rev,
      title: sent.title,
      body: sent.body,
    });
    busy.current = false;
    if (!r.ok) {
      if (r.error.status === 409) {
        setState('closed');
        setMessage(r.error.message);
      }
      return;
    }
    synced.current = { rev: r.data.rev, title: r.data.title, body: r.data.body };
    const next = rebase(sent, now.current, r.data);
    if (next.conflicts) setConflicts((n) => n + next.conflicts);
    if (next.body !== now.current.body || next.title !== now.current.title)
      apply(next.title, next.body);
    take(r.data);
  }, [workspaceId, pageId, apply, take]);

  useEffect(() => {
    if (!active) return;
    let stop = false;
    setState('joining');
    setConflicts(0);
    setMessage('');
    void api<LiveAnswer>('POST', D('')).then((r) => {
      if (stop) return;
      if (!r.ok) {
        setState('error');
        setMessage(r.error.message);
        return;
      }
      synced.current = { rev: r.data.rev, title: r.data.title, body: r.data.body };
      apply(r.data.title, r.data.body);
      take(r.data);
      if (r.data.conflicts) setConflicts(r.data.conflicts);
      setState('live');
    });
    // about every second: an unchanged copy costs the server one read
    const tick = setInterval(() => void sync(), 1000);
    return () => {
      stop = true;
      clearInterval(tick);
      if (synced.current)
        void fetch(D(''), { method: 'DELETE', keepalive: true, credentials: 'same-origin' }).catch(
          () => undefined,
        );
      synced.current = null;
    };
  }, [active, workspaceId, pageId]);

  const setBody = useCallback((b: string) => {
    now.current = { ...now.current, body: b };
    setBodyState(b);
  }, []);
  const setTitle = useCallback((t: string) => {
    now.current = { ...now.current, title: t };
    setTitleState(t);
  }, []);

  /** Sends the last text and saves the merged draft as the next version; the version, or null. */
  const save = useCallback(async (): Promise<number | null> => {
    const from = synced.current;
    if (!from) return null;
    const r = await api<{ version: number; conflicts: number }>('POST', D('/save'), {
      rev: from.rev,
      title: now.current.title.trim() || from.title,
      body: now.current.body,
    });
    if (!r.ok) {
      setMessage(r.error.message);
      return null;
    }
    synced.current = null;
    setState('closed');
    return r.data.version;
  }, [workspaceId, pageId]);

  return { state, title, body, setTitle, setBody, others, conflicts, message, save };
}
