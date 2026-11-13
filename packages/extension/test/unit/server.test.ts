// ── [PCODE-193 | S15 | v0.1.0] B8.1 VS Code on the Orqiva server: task panel with comments, inbox and approvals, timer, CodeLens without Plane ──
// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the parts of the extension that talk to Orqiva, without VS Code: our WebSocket client against
//          a Node server speaking RFC 6455, the board mapping, a folder linked with pe, and the board source
//          that must never set a timer. The whole path against the real server is in the server's tests
//          (test/db/extension.test.ts).
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SocketLike } from '@orqiva/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  boardFromServer,
  ServerConnection,
  type ServerConnectionOptions,
} from '../../src/server/connection';
import { clientFrame, openNodeSocket, readFrames } from '../../src/server/nodeSocket';
import { BoardSource } from '../../src/state/boardSource';
import { readActiveTask, readProjectLink } from '../../src/state/files';
import { findProjectFrom } from '../../src/state/project';
import { Store } from '../../src/state/store';

/** A server frame: unmasked, as RFC 6455 wants from servers. */
function serverFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const head =
    payload.length < 126
      ? Buffer.from([0, payload.length])
      : Buffer.from([0, 126, payload.length >> 8, payload.length & 255]);
  head[0] = (fin ? 0x80 : 0) | opcode;
  return Buffer.concat([head, payload]);
}

const waitFor = async (cond: () => boolean, ms = 2000): Promise<void> => {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error('not observed in time');
    await new Promise((r) => setTimeout(r, 5));
  }
};

describe('the Node WebSocket client', () => {
  let server: Server;
  let port = 0;
  let peer: Socket | null = null;
  let received: { opcode: number; text: string; masked: boolean }[] = [];
  let seenHeaders: Record<string, string | string[] | undefined> = {};
  let wrongAccept = false;

  beforeEach(async () => {
    received = [];
    wrongAccept = false;
    server = createServer();
    server.on('upgrade', (req, socket: Socket) => {
      seenHeaders = req.headers;
      const accept = createHash('sha1')
        .update(String(req.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
        .digest('base64');
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
          (wrongAccept ? 'bogus' : accept) +
          '\r\n\r\n',
      );
      peer = socket;
      let buf = Buffer.alloc(0);
      socket.on('data', (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        const masked = buf.length > 1 && ((buf[1] ?? 0) & 0x80) !== 0;
        const { frames, rest } = readFrames(buf);
        buf = Buffer.from(rest);
        for (const f of frames)
          received.push({ opcode: f.opcode, text: f.payload.toString('utf8'), masked });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    peer?.destroy();
    peer = null;
    await new Promise((r) => server.close(r));
  });

  const connect = (): Promise<{ sock: SocketLike; messages: string[]; closed: () => boolean }> => {
    const messages: string[] = [];
    let closed = false;
    const sock = openNodeSocket('http://127.0.0.1:' + String(port) + '/live?x=1', {
      headers: { Authorization: 'Bearer pe_x' },
    });
    sock.onmessage = (e) => messages.push(String(e.data));
    sock.onclose = () => {
      closed = true;
    };
    return new Promise((resolve) => {
      sock.onopen = () => {
        resolve({ sock, messages, closed: () => closed });
      };
    });
  };

  it('upgrades with our headers, sends masked text and reads text, fragments and pings', async () => {
    const { sock, messages } = await connect();
    expect(seenHeaders['authorization']).toBe('Bearer pe_x');
    sock.send('{"type":"subscribe"}');
    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual({ opcode: 1, text: '{"type":"subscribe"}', masked: true });

    peer?.write(serverFrame(1, Buffer.from('hello')));
    peer?.write(
      Buffer.concat([
        serverFrame(1, Buffer.from('frag'), false),
        serverFrame(0, Buffer.from('mented')),
      ]),
    );
    peer?.write(serverFrame(1, Buffer.from('x'.repeat(300))));
    await waitFor(() => messages.length === 3);
    expect(messages.slice(0, 2)).toEqual(['hello', 'fragmented']);
    expect(messages[2]).toHaveLength(300);

    peer?.write(serverFrame(9, Buffer.from('beat')));
    await waitFor(() => received.some((r) => r.opcode === 10));
    expect(received.find((r) => r.opcode === 10)?.text).toBe('beat');
    sock.close();
  });

  it('closes when the server closes, and answers the close', async () => {
    const { closed } = await connect();
    peer?.write(serverFrame(8, Buffer.from([0x03, 0xe8])));
    await waitFor(closed);
    await waitFor(() => received.some((r) => r.opcode === 8));
  });

  it('refuses a server that answers the handshake with the wrong key', async () => {
    wrongAccept = true;
    let opened = false;
    let closed = false;
    const sock = openNodeSocket('ws://127.0.0.1:' + String(port) + '/live');
    sock.onopen = () => (opened = true);
    sock.onclose = () => (closed = true);
    await waitFor(() => closed);
    expect(opened).toBe(false);
  });

  it('frames round-trip through the reader', () => {
    const big = Buffer.alloc(70_000, 7);
    const { frames, rest } = readFrames(
      Buffer.concat([clientFrame(2, big), clientFrame(1, Buffer.from('a'))]),
    );
    expect(rest).toHaveLength(0);
    expect(frames.map((f) => [f.opcode, f.payload.length])).toEqual([
      [2, 70_000],
      [1, 1],
    ]);
    expect(frames[0]?.payload.every((b) => b === 7)).toBe(true);
  });
});

describe('the board from the server', () => {
  const states = [
    { id: 't', name: 'Todo', group: 'unstarted' },
    { id: 'p', name: 'In Progress', group: 'started' },
    { id: 'd', name: 'Done', group: 'completed' },
  ];
  const item = (n: number, sprintId: string | null, stateId = 't', rank = n) => ({
    id: 'i' + String(n),
    ref: 'APP-' + String(n),
    title: 'Item ' + String(n),
    stateId,
    sprintId,
    labelIds: n === 1 ? ['l1'] : [],
    rank,
    sequence: n,
  });
  const sprint = (id: string, number: number, status: string, endDate: string) => ({
    id,
    number,
    name: 'Sprint ' + String(number),
    goal: '',
    startDate: '2026-10-01',
    endDate,
    status,
  });

  it('puts the active sprint first, then planned, recent completed, and the backlog', () => {
    const board = boardFromServer(
      'https://pe.example.test/',
      states,
      [
        sprint('old', 1, 'completed', '2026-09-01'),
        sprint('done', 2, 'completed', '2026-10-01'),
        sprint('next', 4, 'planned', '2026-10-20'),
        sprint('now', 3, 'active', '2026-10-10'),
      ],
      [item(1, 'now', 'p', 5), item(2, 'now', 't', 1), item(3, null), item(4, 'done', 'd')],
      [{ id: 'l1', name: 'feature' }],
      '2026-10-03',
    );
    expect(board.map((s) => [s.name, s.code, s.isToday, s.source])).toEqual([
      ['Sprint 3', 'S03', true, 'server'],
      ['Sprint 4', 'S04', false, 'server'],
      ['Sprint 2', 'S02', false, 'server'],
      ['Backlog', 'S00', false, 'server'],
    ]);
    expect(board[0]?.items.map((i) => i.ref)).toEqual(['APP-2', 'APP-1']);
    expect(board[0]?.items[1]).toMatchObject({
      state: { name: 'In Progress', group: 'started' },
      labels: ['feature'],
      url: 'https://pe.example.test/items/i1',
      done: false,
    });
    expect(board[2]?.items[0]?.done).toBe(true);
  });
});

describe('a folder linked with pe', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-ext-'));
    fs.mkdirSync(path.join(root, '.orqiva', 'state'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.orqiva', 'project.json'),
      JSON.stringify({
        server: 'http://pe.test',
        workspaceId: 'w1',
        projectId: 'p1',
        projectKey: 'APP',
        projectName: 'App',
      }),
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('is found, read as a link marked with its server, and its pe active task is the active task', () => {
    fs.mkdirSync(path.join(root, 'src'));
    expect(findProjectFrom(path.join(root, 'src'))?.link).toMatchObject({
      identifier: 'APP',
      project_id: 'p1',
      server: 'http://pe.test',
    });
    expect(readProjectLink(root)).toMatchObject({
      identifier: 'APP',
      name: 'App',
      server: 'http://pe.test',
    });
    expect(readActiveTask(root)).toBeNull();
    fs.writeFileSync(
      path.join(root, '.orqiva', 'state', 'active.json'),
      JSON.stringify({
        sessionId: 's',
        ref: 'APP-7',
        taskId: 't7',
        title: 'Seven',
        sprint: 'S03',
        version: '0.2.0',
        marker: 'm',
        files: ['a.ts'],
        pending: [],
        lastProgressAt: 0,
        lastCommit: '',
      }),
    );
    expect(readActiveTask(root)).toMatchObject({
      task: 'APP-7',
      issue_id: 't7',
      sprint: 'S03',
      version: '0.2.0',
      files: ['a.ts'],
      url: 'http://pe.test/items/t7',
    });
    fs.writeFileSync(path.join(root, '.orqiva', 'state', 'active.json'), 'null\n');
    expect(readActiveTask(root)).toBeNull();
  });
});

describe('the board source', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads a Plane board once per start and per refresh, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const store = new Store();
    store.load(null);
    store.state.root = '/x';
    store.state.link = {
      workspace: 'w',
      project_id: 'p',
      identifier: 'APP',
      name: 'App',
      version: '0.1.0',
    };
    const fetchPlane = vi.fn(() => Promise.resolve([]));
    const source = new BoardSource({ store, home: '/home', fetchPlane });
    source.start();
    await vi.runAllTimersAsync();
    expect(fetchPlane).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await source.refreshNow();
    expect(fetchPlane).toHaveBeenCalledTimes(2);
    expect(store.state.online).toBe(true);
    vi.advanceTimersByTime(3_600_000);
    expect(fetchPlane).toHaveBeenCalledTimes(2);
    source.dispose();
  });

  it('says so when an Orqiva folder has no token', () => {
    const store = new Store();
    store.load(null);
    store.state.root = os.tmpdir();
    store.state.link = {
      workspace: 'w',
      project_id: 'p',
      identifier: 'APP',
      name: 'App',
      version: '0.1.0',
      server: 'http://pe.test',
    };
    const source = new BoardSource({
      store,
      home: fs.mkdtempSync(path.join(os.tmpdir(), 'pe-nohome-')),
      fetchPlane: () => Promise.resolve(null),
    });
    source.start();
    expect(store.state.online).toBe(false);
    expect(store.state.lastError).toContain('orq login');
  });
});

describe('the server connection', () => {
  it('reads the board once at start and once per burst of live events', async () => {
    const calls: string[] = [];
    const fetchImpl = ((url: string) => {
      calls.push(url);
      const body =
        url.endsWith('/sprints') || url.endsWith('/items') || url.endsWith('/labels')
          ? []
          : { states: [], version: '0.3.0' };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }) as unknown as typeof fetch;
    let socket: SocketLike | null = null;
    let headers: Record<string, string> = {};
    const boards: string[] = [];
    const opts: ServerConnectionOptions = {
      target: {
        root: '/repo',
        token: 'pe_tok',
        link: {
          server: 'http://pe.test',
          workspaceId: 'w1',
          projectId: 'p1',
          projectKey: 'APP',
          projectName: 'App',
        },
      },
      fetchImpl,
      debounceMs: 20,
      onBoard: (b) => boards.push(b.version),
      onStatus: () => undefined,
      openSocket: (url, h) => {
        expect(url).toBe('http://pe.test/live');
        headers = h;
        socket = {
          onopen: null,
          onclose: null,
          onmessage: null,
          send: () => undefined,
          close: () => undefined,
        };
        return socket;
      },
    };
    const conn = new ServerConnection(opts);
    conn.start();
    await waitFor(() => boards.length === 1);
    expect(headers).toEqual({ Authorization: 'Bearer pe_tok' });
    const s = socket as unknown as SocketLike;
    s.onopen?.();
    s.onmessage?.({
      data: JSON.stringify({ type: 'subscribed', workspaceId: 'w1', sequence: 10 }),
    });
    for (let n = 11; n <= 15; n++)
      s.onmessage?.({
        data: JSON.stringify({
          type: 'event',
          event: {
            sequence: n,
            projectid: 'p1',
            type: 'orqiva.item.moved',
            subject: 'i',
            data: {},
          },
        }),
      });
    // an event of another project does not touch this board
    s.onmessage?.({
      data: JSON.stringify({
        type: 'event',
        event: {
          sequence: 16,
          projectid: 'p2',
          type: 'orqiva.item.moved',
          subject: 'i',
          data: {},
        },
      }),
    });
    await waitFor(() => boards.length >= 2);
    await new Promise((r) => setTimeout(r, 80));
    // subscribed once (1 read) + five events in one burst (1 read)
    expect(boards.length).toBeLessThanOrEqual(3);
    expect(boards.at(-1)).toBe('0.3.0');
    expect(calls.every((u) => u.startsWith('http://pe.test/api/workspaces/w1/projects/p1'))).toBe(
      true,
    );
    conn.stop();
  });
});
