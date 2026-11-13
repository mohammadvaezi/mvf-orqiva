// ── [PCODE-95 | S15 | v0.1.0] Build our own WebSocket gateway (RFC 6455) with typed protocol and SSE fallback ──
//    Why:  a raw WebSocket client for tests: it writes exactly the frames a test asks for (masked or not,
//          fragmented, oversized, invalid UTF-8) and reads every frame the server sends, so the server's
//          protocol handling is checked byte by byte rather than through a library that would hide it.
import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';

export interface Frame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
}

export function clientFrame(
  opcode: number,
  payload: Buffer | string,
  opts: { fin?: boolean; mask?: boolean; rsv?: number } = {},
): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const mask = opts.mask ?? true;
  const len = data.length;
  const head = Buffer.alloc(len < 126 ? 2 : len < 65536 ? 4 : 10);
  head[0] = ((opts.fin ?? true) ? 0x80 : 0) | (opts.rsv ?? 0) | opcode;
  const m = mask ? 0x80 : 0;
  if (len < 126) head[1] = m | len;
  else if (len < 65536) {
    head[1] = m | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = m | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  if (!mask) return Buffer.concat([head, data]);
  const key = randomBytes(4);
  const masked = Buffer.from(data);
  for (let i = 0; i < masked.length; i++) masked[i] = (masked[i] ?? 0) ^ (key[i & 3] ?? 0);
  return Buffer.concat([head, key, masked]);
}

export class RawWsClient {
  readonly frames: Frame[] = [];
  status = 0;
  headers = '';
  body = '';
  ended = false;
  private buf = Buffer.alloc(0);
  private upgraded = false;

  private constructor(readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.onData(chunk);
    });
    socket.on('close', () => {
      this.ended = true;
    });
    socket.on('error', () => {
      this.ended = true;
    });
  }

  static async open(
    port: number,
    opts: {
      path?: string;
      cookie?: string;
      origin?: string;
      version?: string;
      key?: string;
      /** [PCODE-224 | S15 | v0.1.0] a token, as the phone app sends it */
      bearer?: string;
    } = {},
  ): Promise<RawWsClient> {
    const socket = connect(port, '127.0.0.1');
    await new Promise<void>((r) => socket.once('connect', r));
    const c = new RawWsClient(socket);
    const lines = [
      'GET ' + (opts.path ?? '/live') + ' HTTP/1.1',
      'Host: 127.0.0.1:' + String(port),
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + (opts.key ?? randomBytes(16).toString('base64')),
      'Sec-WebSocket-Version: ' + (opts.version ?? '13'),
      ...(opts.cookie ? ['Cookie: ' + opts.cookie] : []),
      ...(opts.origin ? ['Origin: ' + opts.origin] : []),
      ...(opts.bearer ? ['Authorization: Bearer ' + opts.bearer] : []),
    ];
    socket.write(lines.join('\r\n') + '\r\n\r\n');
    await c.until(() => c.status !== 0);
    return c;
  }

  private onData(chunk: Buffer): void {
    this.buf = Buffer.concat([this.buf, chunk]);
    if (!this.upgraded) {
      const end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      this.headers = this.buf.subarray(0, end).toString();
      this.status = Number(/^HTTP\/1\.1 (\d{3})/.exec(this.headers)?.[1] ?? 0);
      this.buf = this.buf.subarray(end + 4);
      if (this.status !== 101) {
        this.body = this.buf.toString();
        return;
      }
      this.upgraded = true;
    }
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      let len = (b[1] ?? 0) & 0x7f;
      let off = 2;
      if (len === 126) {
        if (b.length < 4) return;
        len = b.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (b.length < 10) return;
        len = Number(b.readBigUInt64BE(2));
        off = 10;
      }
      if (b.length < off + len) return;
      this.frames.push({
        fin: ((b[0] ?? 0) & 0x80) !== 0,
        opcode: (b[0] ?? 0) & 0x0f,
        payload: Buffer.from(b.subarray(off, off + len)),
      });
      this.buf = b.subarray(off + len);
    }
  }

  send(frame: Buffer): void {
    this.socket.write(frame);
  }

  sendJson(value: unknown): void {
    this.send(clientFrame(0x1, JSON.stringify(value)));
  }

  /** Text messages received, parsed as JSON. */
  messages<T = Record<string, unknown>>(): T[] {
    return this.frames
      .filter((f) => f.opcode === 0x1)
      .map((f) => JSON.parse(f.payload.toString('utf8')) as T);
  }

  closeCode(): number | null {
    const f = this.frames.find((x) => x.opcode === 0x8);
    return f && f.payload.length >= 2 ? f.payload.readUInt16BE(0) : null;
  }

  async until(cond: () => boolean, ms = 5000): Promise<void> {
    const end = Date.now() + ms;
    while (!cond()) {
      if (Date.now() > end)
        throw new Error(
          'timed out; frames: ' +
            JSON.stringify(this.frames.map((f) => [f.opcode, f.payload.toString()])),
        );
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  destroy(): void {
    this.socket.destroy();
  }
}
