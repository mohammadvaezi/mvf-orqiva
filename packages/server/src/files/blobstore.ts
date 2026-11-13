// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-168 | S15 | v0.1.0] B3.1 Ideation and files on the server: blob store, sources, requirements, questions, risks, assumptions, decisions, glossary, scores, extraction ──
//    Why:  our own store for uploaded bytes, on the server's disk next to the database: each file is kept
//          once by its SHA-256 (two uploads of the same bytes share it), written to a temporary name and
//          renamed so a crash never leaves half a file. `orq backup` copies the directory.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const SHA = /^[0-9a-f]{64}$/;

export class BlobStore {
  readonly root: string;
  constructor(dataDir: string) {
    this.root = resolve(dataDir);
  }

  /** The storage key of a hash: blobs/ab/cd/<sha256>. */
  static keyOf(sha256: string): string {
    if (!SHA.test(sha256)) throw new Error('not a sha256');
    return 'blobs/' + sha256.slice(0, 2) + '/' + sha256.slice(2, 4) + '/' + sha256;
  }

  private pathOf(key: string): string {
    const p = resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('key outside the store');
    return p;
  }

  async put(data: Buffer): Promise<{ sha256: string; key: string }> {
    const sha256 = createHash('sha256').update(data).digest('hex');
    const key = BlobStore.keyOf(sha256);
    const path = this.pathOf(key);
    const exists = await stat(path).then(
      (s) => s.size === data.length,
      () => false,
    );
    if (!exists) {
      await mkdir(dirname(path), { recursive: true });
      const tmp = join(dirname(path), '.' + sha256 + '.' + randomBytes(6).toString('hex') + '.tmp');
      await writeFile(tmp, data);
      await rename(tmp, path);
    }
    return { sha256, key };
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }
}
