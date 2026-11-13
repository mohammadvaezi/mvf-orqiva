// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
// ── [PCODE-101 | S15 | v0.1.0] Add presence: heartbeats, avatars on cards, who-is-where ──
//    Why:  the WebSocket protocol on node:net and node:crypto, server side. Handshake (section 4.2), frames
//          (5.2): client frames must be masked, control frames short and unfragmented, text valid UTF-8;
//          fragmented messages are joined; the close handshake echoes the code (5.5.1); pings get pongs.
//          A message over the size limit closes with 1009, a peer too slow to read with 1013.
import { createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const OP = {
  continuation: 0x0,
  text: 0x1,
  binary: 0x2,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const;

export const CLOSE = {
  normal: 1000,
  goingAway: 1001,
  protocolError: 1002,
  unsupportedData: 1003,
  invalidPayload: 1007,
  policy: 1008,
  tooBig: 1009,
  internal: 1011,
  tryAgainLater: 1013,
} as const;

export function acceptKey(key: string): string {
  return createHash('sha1')
    .update(key + GUID)
    .digest('base64');
}

/** Why an upgrade request is not a valid WebSocket handshake, or null when it is. */
export function handshakeProblem(req: IncomingMessage): { status: number; reason: string } | null {
  if (req.method !== 'GET') return { status: 400, reason: 'WebSocket handshakes use GET' };
  if ((req.headers.upgrade ?? '').toLowerCase() !== 'websocket')
    return { status: 400, reason: 'Upgrade: websocket is missing' };
  if (!/\bupgrade\b/i.test(req.headers.connection ?? ''))
    return { status: 400, reason: 'Connection: Upgrade is missing' };
  if (req.headers['sec-websocket-version'] !== '13')
    return { status: 426, reason: 'Only WebSocket version 13 is supported' };
  const key = req.headers['sec-websocket-key'];
  if (typeof key !== 'string' || Buffer.from(key, 'base64').length !== 16)
    return { status: 400, reason: 'Sec-WebSocket-Key is not 16 bytes of base64' };
  return null;
}

/** Refuses an upgrade with a plain HTTP answer and closes the connection. */
export function refuseUpgrade(socket: Duplex, status: number, reason: string): void {
  const text =
    {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      426: 'Upgrade Required',
    }[status] ?? 'Error';
  const extra = status === 426 ? 'Sec-WebSocket-Version: 13\r\n' : '';
  socket.end(
    'HTTP/1.1 ' +
      String(status) +
      ' ' +
      text +
      '\r\nConnection: close\r\n' +
      extra +
      'Content-Type: text/plain\r\nContent-Length: ' +
      String(Buffer.byteLength(reason)) +
      '\r\n\r\n' +
      reason,
  );
}

/** A server frame: never masked (5.1). */
export function encodeFrame(opcode: number, payload: Buffer, fin = true): Buffer {
  const len = payload.length;
  const head = len < 126 ? Buffer.alloc(2) : len < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  head[0] = (fin ? 0x80 : 0) | opcode;
  if (len < 126) head[1] = len;
  else if (len < 65536) {
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

export interface WsOptions {
  /** largest message accepted, after joining fragments */
  maxMessageBytes?: number;
  /** a peer that lets this much pile up unsent is too slow */
  maxBufferedBytes?: number;
  /** ping interval; a peer that has not answered the previous ping by then is closed */
  heartbeatMs?: number;
}

export interface WsHandlers {
  onText(text: string): void;
  onClose(code: number, reason: string): void;
}

const utf8 = new TextDecoder('utf-8', { fatal: true });

/** One accepted WebSocket connection. */
export class WebSocketConnection {
  private buffer: Buffer = Buffer.alloc(0);
  private fragments: Buffer[] = [];
  private fragmentBytes = 0;
  private closing = false;
  private closed = false;
  private alive = true;
  private heartbeat: NodeJS.Timeout | null = null;
  private readonly maxMessage: number;
  private readonly maxBuffered: number;

  constructor(
    private readonly socket: Duplex,
    private readonly handlers: WsHandlers,
    opts: WsOptions = {},
  ) {
    this.maxMessage = opts.maxMessageBytes ?? 1024 * 1024;
    this.maxBuffered = opts.maxBufferedBytes ?? 4 * 1024 * 1024;
    socket.on('data', (chunk: Buffer) => {
      this.receive(chunk);
    });
    socket.on('close', () => {
      this.finish(CLOSE.goingAway, 'connection closed');
    });
    // [PCODE-101 | S15 | v0.1.0] the HTTP server keeps sockets half-open: when the peer closes its side we
    // get 'end' but no 'close' until we close ours. Close ours and finish now, or a gone client would look
    // connected (and present) until the heartbeat noticed.
    socket.on('end', () => {
      socket.end();
      this.finish(CLOSE.goingAway, 'peer closed the connection');
    });
    socket.on('error', () => {
      this.finish(CLOSE.goingAway, 'connection error');
    });
    const beat = opts.heartbeatMs ?? 30_000;
    this.heartbeat = setInterval(() => {
      if (!this.alive) {
        this.socket.destroy();
        return;
      }
      this.alive = false;
      this.write(OP.ping, Buffer.alloc(0));
    }, beat);
    this.heartbeat.unref();
  }

  /** Accepts the handshake: writes the 101 answer. */
  static accept(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    handlers: WsHandlers,
    opts?: WsOptions,
  ): WebSocketConnection {
    const key = String(req.headers['sec-websocket-key']);
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' +
        acceptKey(key) +
        '\r\n\r\n',
    );
    const conn = new WebSocketConnection(socket, handlers, opts);
    if (head.length) conn.receive(head);
    return conn;
  }

  private hasClosed(): boolean {
    return this.closed;
  }

  get isOpen(): boolean {
    return !this.closing && !this.closed;
  }

  sendText(text: string): void {
    if (!this.isOpen) return;
    this.write(OP.text, Buffer.from(text, 'utf8'));
    if (this.socket.writableLength > this.maxBuffered)
      this.close(CLOSE.tryAgainLater, 'too slow to keep up');
  }

  /** Starts the close handshake; the socket ends when the peer answers, or after 5 s. */
  close(code: number = CLOSE.normal, reason = ''): void {
    if (this.closing || this.closed) return;
    this.closing = true;
    const r = Buffer.from(reason.slice(0, 120), 'utf8');
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    this.write(OP.close, payload);
    const t = setTimeout(() => this.socket.destroy(), 5000);
    t.unref();
  }

  private write(opcode: number, payload: Buffer): void {
    if (!this.closed && !this.socket.destroyed) this.socket.write(encodeFrame(opcode, payload));
  }

  private finish(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.handlers.onClose(code, reason);
  }

  private fail(code: number, reason: string): void {
    this.close(code, reason);
    this.buffer = Buffer.alloc(0);
    this.finish(code, reason);
  }

  private receive(chunk: Buffer): void {
    if (this.closed) return;
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    // handling a frame may close the connection, so the state is read afresh on every pass
    while (!this.hasClosed()) {
      const b = this.buffer;
      if (b.length < 2) return;
      const b0 = b[0] ?? 0;
      const b1 = b[1] ?? 0;
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      if (b0 & 0x70) {
        this.fail(CLOSE.protocolError, 'reserved bits set without an extension');
        return;
      }
      if (!(b1 & 0x80)) {
        this.fail(CLOSE.protocolError, 'client frames must be masked');
        return;
      }
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        const big = b.readBigUInt64BE(2);
        if (big > BigInt(this.maxMessage)) {
          this.fail(CLOSE.tooBig, 'message too big');
          return;
        }
        len = Number(big);
        offset = 10;
      }
      const isControl = opcode >= 0x8;
      if (isControl && (!fin || len > 125)) {
        this.fail(CLOSE.protocolError, 'control frames must be short and unfragmented');
        return;
      }
      if (!isControl && this.fragmentBytes + len > this.maxMessage) {
        this.fail(CLOSE.tooBig, 'message too big');
        return;
      }
      if (b.length < offset + 4 + len) return;
      const mask = b.subarray(offset, offset + 4);
      const payload = Buffer.from(b.subarray(offset + 4, offset + 4 + len));
      for (let i = 0; i < payload.length; i++) payload[i] = (payload[i] ?? 0) ^ (mask[i & 3] ?? 0);
      this.buffer = b.subarray(offset + 4 + len);
      this.frame(fin, opcode, payload);
    }
  }

  private frame(fin: boolean, opcode: number, payload: Buffer): void {
    switch (opcode) {
      case OP.ping:
        this.write(OP.pong, payload);
        return;
      case OP.pong:
        this.alive = true;
        return;
      case OP.close: {
        if (payload.length === 1) {
          this.fail(CLOSE.protocolError, 'close payload of one byte');
          return;
        }
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : CLOSE.normal;
        const validCode =
          (code >= 1000 && code <= 1003) ||
          (code >= 1007 && code <= 1011) ||
          (code >= 3000 && code <= 4999);
        if (!validCode) {
          this.fail(CLOSE.protocolError, 'invalid close code');
          return;
        }
        if (!this.closing) {
          this.closing = true;
          this.write(OP.close, payload.subarray(0, 2));
        }
        this.socket.end();
        this.finish(code, payload.subarray(2).toString('utf8'));
        return;
      }
      case OP.binary: {
        this.fail(CLOSE.unsupportedData, 'only text messages are accepted');
        return;
      }
      case OP.text:
      case OP.continuation: {
        if (opcode === OP.text && this.fragments.length) {
          this.fail(CLOSE.protocolError, 'new message before the last one finished');
          return;
        }
        if (opcode === OP.continuation && !this.fragments.length) {
          this.fail(CLOSE.protocolError, 'continuation without a message');
          return;
        }
        this.fragments.push(payload);
        this.fragmentBytes += payload.length;
        if (!fin) return;
        const whole = Buffer.concat(this.fragments);
        this.fragments = [];
        this.fragmentBytes = 0;
        let text: string;
        try {
          text = utf8.decode(whole);
        } catch {
          this.fail(CLOSE.invalidPayload, 'text is not valid UTF-8');
          return;
        }
        if (this.isOpen) this.handlers.onText(text);
        return;
      }
      default: {
        this.fail(CLOSE.protocolError, 'unknown opcode');
        return;
      }
    }
  }
}
