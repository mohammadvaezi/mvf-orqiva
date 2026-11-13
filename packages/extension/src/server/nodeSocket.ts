// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-105 | S15 | v0.1.0] Move the VS Code extension to the new API over WebSocket and remove polling ──
//    Why:  the extension host is Node, and the Node inside VS Code cannot be relied on to have a WebSocket.
//          This is our own client side of RFC 6455 on node:net / node:tls: the opening handshake with the
//          accept-key check, masked frames out (as the RFC demands of clients), fragmented text in, ping
//          answered with pong, and the closing handshake. It offers the same small surface as the browser's
//          WebSocket (SocketLike), so the shared LiveClient runs on it unchanged.
import { createHash, randomBytes } from 'node:crypto';
import * as net from 'node:net';
import * as tls from 'node:tls';
import type { SocketLike } from '@orqiva/shared';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MESSAGE = 16 * 1024 * 1024;

export const acceptKey = (key: string): string =>
  createHash('sha1')
    .update(key + GUID)
    .digest('base64');

/** One client frame: FIN set, masked with a fresh key. */
export function clientFrame(opcode: number, payload: Buffer, mask = randomBytes(4)): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = 0x80 | opcode;
  if (len < 126) head[1] = 0x80 | len;
  else if (len < 65536) {
    head[1] = 0x80 | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  const body = Buffer.alloc(len);
  for (let i = 0; i < len; i++) body[i] = (payload[i] ?? 0) ^ (mask[i % 4] ?? 0);
  return Buffer.concat([head, mask, body]);
}

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

/** Reads whole frames off the front of `buf`; returns them and what is left over. */
export function readFrames(buf: Buffer): { frames: Frame[]; rest: Buffer } {
  const frames: Frame[] = [];
  let at = 0;
  for (;;) {
    if (buf.length - at < 2) break;
    const b0 = buf[at] ?? 0;
    const b1 = buf[at + 1] ?? 0;
    let len = b1 & 0x7f;
    let head = 2;
    if (len === 126) {
      if (buf.length - at < 4) break;
      len = buf.readUInt16BE(at + 2);
      head = 4;
    } else if (len === 127) {
      if (buf.length - at < 10) break;
      const big = buf.readBigUInt64BE(at + 2);
      if (big > BigInt(MAX_MESSAGE)) throw new Error('frame too large');
      len = Number(big);
      head = 10;
    }
    const masked = (b1 & 0x80) !== 0;
    const maskLen = masked ? 4 : 0;
    if (buf.length - at < head + maskLen + len) break;
    let payload = buf.subarray(at + head + maskLen, at + head + maskLen + len);
    if (masked) {
      const mask = buf.subarray(at + head, at + head + 4);
      payload = Buffer.from(payload.map((v, i) => v ^ (mask[i % 4] ?? 0)));
    }
    frames.push({ fin: (b0 & 0x80) !== 0, opcode: b0 & 0x0f, payload: Buffer.from(payload) });
    at += head + maskLen + len;
  }
  return { frames, rest: buf.subarray(at) };
}

export interface NodeSocketOptions {
  /** extra request headers, e.g. Authorization: Bearer orq_… */
  headers?: Record<string, string>;
  /** fails the handshake when the server does not answer in time */
  timeoutMs?: number;
}

/** Opens ws:// or wss:// (http:// and https:// are taken to mean the same). */
export function openNodeSocket(url: string, opts: NodeSocketOptions = {}): SocketLike {
  const u = new URL(url.replace(/^http/, 'ws'));
  const secure = u.protocol === 'wss:';
  const port = Number(u.port || (secure ? 443 : 80));
  const key = randomBytes(16).toString('base64');
  const conn: net.Socket = secure
    ? tls.connect({ host: u.hostname, port, servername: u.hostname })
    : net.connect({ host: u.hostname, port });

  let open = false;
  let closed = false;
  let handshake = Buffer.alloc(0);
  let pending = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let partOpcode = 0;

  const sock: SocketLike = {
    onopen: null,
    onclose: null,
    onmessage: null,
    send(text: string) {
      if (open && !closed) conn.write(clientFrame(0x1, Buffer.from(text, 'utf8')));
    },
    close() {
      if (closed) return;
      if (open) conn.write(clientFrame(0x8, Buffer.from([0x03, 0xe8])));
      conn.end();
      finish();
    },
  };

  const finish = (): void => {
    if (closed) return;
    closed = true;
    open = false;
    conn.destroy();
    sock.onclose?.();
  };

  const timer = setTimeout(() => {
    if (!open) finish();
  }, opts.timeoutMs ?? 10_000);

  conn.on(secure ? 'secureConnect' : 'connect', () => {
    const headers = {
      Host: u.host,
      Upgrade: 'websocket',
      Connection: 'Upgrade',
      'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13',
      ...opts.headers,
    };
    conn.write(
      'GET ' +
        u.pathname +
        u.search +
        ' HTTP/1.1\r\n' +
        Object.entries(headers)
          .map(([k, v]) => k + ': ' + v + '\r\n')
          .join('') +
        '\r\n',
    );
  });

  const onFrames = (data: Buffer): void => {
    pending = Buffer.concat([pending, data]);
    const { frames, rest } = readFrames(pending);
    pending = Buffer.from(rest);
    for (const f of frames) {
      if (f.opcode === 0x9) conn.write(clientFrame(0xa, f.payload));
      else if (f.opcode === 0x8) {
        conn.write(clientFrame(0x8, f.payload.subarray(0, 2)));
        finish();
        return;
      } else if (f.opcode === 0x1 || f.opcode === 0x2 || f.opcode === 0x0) {
        if (f.opcode !== 0x0) {
          parts = [];
          partOpcode = f.opcode;
        }
        parts.push(f.payload);
        if (parts.reduce((n, p) => n + p.length, 0) > MAX_MESSAGE) {
          sock.close();
          return;
        }
        if (f.fin) {
          const whole = Buffer.concat(parts);
          parts = [];
          sock.onmessage?.({ data: partOpcode === 0x1 ? whole.toString('utf8') : whole });
        }
      }
    }
  };

  conn.on('data', (data: Buffer) => {
    if (closed) return;
    try {
      if (open) {
        onFrames(data);
        return;
      }
      handshake = Buffer.concat([handshake, data]);
      const end = handshake.indexOf('\r\n\r\n');
      if (end < 0) {
        if (handshake.length > 16_384) finish();
        return;
      }
      const lines = handshake.subarray(0, end).toString('latin1').split('\r\n');
      const status = /^HTTP\/1\.1 (\d{3})/.exec(lines[0] ?? '')?.[1];
      const accept = lines
        .find((l) => /^sec-websocket-accept:/i.test(l))
        ?.slice('sec-websocket-accept:'.length)
        .trim();
      if (status !== '101' || accept !== acceptKey(key)) {
        finish();
        return;
      }
      open = true;
      clearTimeout(timer);
      sock.onopen?.();
      const rest = handshake.subarray(end + 4);
      if (rest.length) onFrames(Buffer.from(rest));
    } catch {
      finish();
    }
  });
  conn.on('error', finish);
  conn.on('close', finish);
  conn.on('end', finish);
  return sock;
}
