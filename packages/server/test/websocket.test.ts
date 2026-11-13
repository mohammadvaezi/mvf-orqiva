// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
//    Why:  our conformance set for RFC 6455, run against the connection class behind a plain HTTP server
//          that echoes text: the handshake, framing and every way a peer can break the protocol.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WebSocketConnection,
  acceptKey,
  encodeFrame,
  handshakeProblem,
  refuseUpgrade,
} from '../src/live/websocket.js';
import { RawWsClient, clientFrame } from './wsclient.js';

let server: Server;
let port = 0;
const closes: number[] = [];
const upgraded = new Set<import('node:stream').Duplex>();

beforeAll(async () => {
  server = createServer();
  server.on('upgrade', (req, socket, head) => {
    // upgraded sockets leave the HTTP server's books: track them so the suite can close them
    upgraded.add(socket);
    const problem = handshakeProblem(req);
    if (problem) {
      refuseUpgrade(socket, problem.status, problem.reason);
      return;
    }
    const conn: WebSocketConnection = WebSocketConnection.accept(
      req,
      socket,
      head,
      {
        onText: (t) => {
          conn.sendText('echo:' + t);
        },
        onClose: (code) => closes.push(code),
      },
      { maxMessageBytes: 1024, heartbeatMs: 60_000 },
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const sock of upgraded) sock.destroy();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});

describe('handshake (RFC 6455 4.2)', () => {
  it('computes the accept key of the RFC example', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  });

  it('switches protocols with the right accept header', async () => {
    const c = await RawWsClient.open(port, { key: 'dGhlIHNhbXBsZSBub25jZQ==' });
    expect(c.status).toBe(101);
    expect(c.headers).toContain('Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
    c.destroy();
  });

  it('answers another version with 426 and the version it speaks', async () => {
    const c = await RawWsClient.open(port, { version: '8' });
    expect(c.status).toBe(426);
    expect(c.headers).toContain('Sec-WebSocket-Version: 13');
  });

  it('refuses a key that is not 16 bytes', async () => {
    expect((await RawWsClient.open(port, { key: 'c2hvcnQ=' })).status).toBe(400);
  });
});

describe('frames (RFC 6455 5)', () => {
  const open = (): Promise<RawWsClient> => RawWsClient.open(port);

  it('echoes text, short and long (16-bit length)', async () => {
    const c = await open();
    c.send(clientFrame(0x1, 'hello'));
    c.send(clientFrame(0x1, 'x'.repeat(500)));
    await c.until(() => c.frames.length === 2);
    expect(c.frames.map((f) => f.payload.toString())).toEqual([
      'echo:hello',
      'echo:' + 'x'.repeat(500),
    ]);
    c.destroy();
  });

  it('joins a fragmented message, with a ping in between', async () => {
    const c = await open();
    c.send(clientFrame(0x1, 'frag', { fin: false }));
    c.send(clientFrame(0x9, 'mid'));
    c.send(clientFrame(0x0, 'ment', { fin: false }));
    c.send(clientFrame(0x0, 'ed'));
    await c.until(() => c.frames.length === 2);
    expect(c.frames[0]).toMatchObject({ opcode: 0xa });
    expect(c.frames[0]?.payload.toString()).toBe('mid');
    expect(c.frames[1]?.payload.toString()).toBe('echo:fragmented');
    c.destroy();
  });

  it('answers a close with the same code and ends the connection', async () => {
    const c = await open();
    const payload = Buffer.alloc(2);
    payload.writeUInt16BE(1000);
    c.send(clientFrame(0x8, payload));
    await c.until(() => c.ended);
    expect(c.closeCode()).toBe(1000);
  });

  const failsWith = async (frame: Buffer | Buffer[], code: number): Promise<void> => {
    const c = await open();
    for (const f of Array.isArray(frame) ? frame : [frame]) c.send(f);
    await c.until(() => c.closeCode() !== null);
    expect(c.closeCode()).toBe(code);
    c.destroy();
  };

  it('closes 1002 on an unmasked client frame', () =>
    failsWith(clientFrame(0x1, 'plain', { mask: false }), 1002));
  it('closes 1002 on reserved bits without an extension', () =>
    failsWith(clientFrame(0x1, 'x', { rsv: 0x40 }), 1002));
  it('closes 1002 on a fragmented control frame', () =>
    failsWith(clientFrame(0x9, 'p', { fin: false }), 1002));
  it('closes 1002 on a continuation with nothing to continue', () =>
    failsWith(clientFrame(0x0, 'x'), 1002));
  it('closes 1002 on an unknown opcode', () => failsWith(clientFrame(0x3, 'x'), 1002));
  it('closes 1002 on an invalid close code', () =>
    failsWith(clientFrame(0x8, Buffer.from([0x03, 0xe7])), 1002));
  it('closes 1003 on binary data', () => failsWith(clientFrame(0x2, Buffer.from([1, 2, 3])), 1003));
  it('closes 1007 on invalid UTF-8', () =>
    failsWith(clientFrame(0x1, Buffer.from([0xc3, 0x28])), 1007));
  it('closes 1009 on a message over the limit, even split into fragments', async () => {
    await failsWith(clientFrame(0x1, 'y'.repeat(2000)), 1009);
    await failsWith(
      [clientFrame(0x1, 'z'.repeat(700), { fin: false }), clientFrame(0x0, 'z'.repeat(700))],
      1009,
    );
  });

  // [PCODE-101 | S15 | v0.1.0] a peer that just closes its side (no close frame) is gone at once, not
  // after the heartbeat: the HTTP server keeps sockets half-open, so the connection must notice 'end'
  it('notices a peer that closes its side without a close frame', async () => {
    const before = closes.length;
    const c = await open();
    c.socket.end();
    await c.until(() => closes.length > before);
    expect(closes.at(-1)).toBe(1001);
  });

  it('reads frames however the bytes are split on the wire', async () => {
    const c = await open();
    const bytes = clientFrame(0x1, 'split across many writes');
    for (const b of bytes) c.send(Buffer.from([b]));
    await c.until(() => c.frames.length === 1);
    expect(c.frames[0]?.payload.toString()).toBe('echo:split across many writes');
    c.destroy();
  });
});

describe('server frames', () => {
  it('are never masked and use 7, 16 and 64-bit lengths', () => {
    expect(encodeFrame(0x1, Buffer.alloc(10)).subarray(0, 2)).toEqual(Buffer.from([0x81, 10]));
    expect(encodeFrame(0x1, Buffer.alloc(300)).subarray(0, 4)).toEqual(
      Buffer.from([0x81, 126, 0x01, 0x2c]),
    );
    expect(encodeFrame(0x1, Buffer.alloc(70_000))[1]).toBe(127);
  });
});
