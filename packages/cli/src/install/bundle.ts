// ── [PCODE-215 | S15 | v0.1.0] T19.4 Air-gapped install (orq bundle, install --bundle), verified backups, licence and SBOM review ──
//    Why:  some sites have no internet. On a connected machine, `orq bundle` saves everything an install
//          needs (the server image, PostgreSQL, Caddy for TLS) into one tar, with a manifest naming the
//          images and the tar's SHA-256. On the closed site `orq install --bundle FILE` checks the tar
//          against it, loads the images and installs without pulling anything. The licence works offline
//          already (signed keys).
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { InstallError, type Exec } from './install.js';

export const BUNDLE_IMAGES = ['postgres:17', 'caddy:2'];

export interface BundleManifest {
  orqiva: string;
  created: string;
  /** the server image first, then the others */
  images: string[];
  file: string;
  bytes: number;
  sha256: string;
  /** [PCODE-222 | S15 | v0.1.0] the command line, one file beside the bundle */
  cli?: { file: string; sha256: string };
}

/** SHA-256 of a (large) file, streamed. */
export function sha256Of(file: string): Promise<string> {
  return new Promise((ok, fail) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', fail)
      .on('end', () => {
        ok(h.digest('hex'));
      });
  });
}

const run = async (exec: Exec, args: string[], what: string): Promise<string> => {
  const r = await exec('docker', args, process.cwd()).catch(() => ({ code: 127, out: '' }));
  if (r.code !== 0) throw new InstallError(what + ':\n' + r.out.split('\n').slice(-10).join('\n'));
  return r.out;
};

/** Saves the images into one tar with a manifest beside it (FILE.json). */
export async function bundle(opts: {
  image: string;
  /** build the server image from this repository first */
  build?: string;
  out: string;
  version: string;
  exec: Exec;
  log: (line: string) => void;
  now?: Date;
  /** [PCODE-222 | S15 | v0.1.0] orq.mjs, copied beside the bundle so the closed site has the command */
  cli?: string;
}): Promise<BundleManifest> {
  const out = resolve(opts.out);
  if (opts.build) {
    opts.log('Building ' + opts.image + ' from ' + resolve(opts.build) + '…');
    await run(
      opts.exec,
      ['build', '-t', opts.image, resolve(opts.build)],
      'The image build failed',
    );
  }
  for (const img of BUNDLE_IMAGES) {
    opts.log('Pulling ' + img + '…');
    await run(
      opts.exec,
      ['pull', img],
      'Pulling ' + img + ' failed (this step needs the internet)',
    );
  }
  const images = [opts.image, ...BUNDLE_IMAGES];
  opts.log('Saving ' + images.join(', ') + ' to ' + basename(out) + '…');
  await run(opts.exec, ['save', '-o', out, ...images], 'Saving the images failed');
  if (!existsSync(out)) throw new InstallError('The bundle was not written to ' + out);
  const manifest: BundleManifest = {
    orqiva: opts.version,
    created: (opts.now ?? new Date()).toISOString(),
    images,
    file: basename(out),
    bytes: statSync(out).size,
    sha256: await sha256Of(out),
  };
  // [PCODE-222 | S15 | v0.1.0] the closed site needs the command too: orq.mjs beside the tar
  if (opts.cli && existsSync(opts.cli)) {
    const cli = join(dirname(out), 'orq.mjs');
    if (resolve(opts.cli) !== cli) copyFileSync(opts.cli, cli);
    manifest.cli = { file: 'orq.mjs', sha256: await sha256Of(cli) };
    opts.log('Command line: orq.mjs (run it with node orq.mjs)');
  } else
    opts.log('The command line is not in the bundle: run orq bundle from orq.mjs, or pass --cli');
  writeFileSync(out + '.json', JSON.stringify(manifest, null, 2) + '\n');
  opts.log(
    'Bundle: ' +
      out +
      ' (' +
      String(Math.round(manifest.bytes / 1_048_576)) +
      ' MB), manifest ' +
      basename(out) +
      '.json',
  );
  return manifest;
}

/** Checks a bundle against its manifest and loads its images; returns the server image. */
export async function loadBundle(opts: {
  file: string;
  exec: Exec;
  log: (line: string) => void;
}): Promise<string> {
  const file = resolve(opts.file);
  if (!existsSync(file)) throw new InstallError('There is no bundle ' + file);
  if (!existsSync(file + '.json'))
    throw new InstallError(
      'The manifest ' + basename(file) + '.json is missing; copy it with the bundle',
    );
  let m: BundleManifest;
  try {
    m = JSON.parse(readFileSync(file + '.json', 'utf8')) as BundleManifest;
  } catch {
    throw new InstallError('The manifest ' + basename(file) + '.json cannot be read');
  }
  if (!Array.isArray(m.images) || !m.images[0] || !/^[0-9a-f]{64}$/.test(m.sha256))
    throw new InstallError(
      'The manifest ' + basename(file) + '.json is not an Orqiva bundle manifest',
    );
  opts.log('Checking ' + basename(file) + ' against its manifest…');
  if ((await sha256Of(file)) !== m.sha256)
    throw new InstallError(
      basename(file) +
        ' does not match its manifest: it was changed or damaged on the way. Copy it again.',
    );
  opts.log('Loading ' + m.images.join(', ') + '…');
  await run(opts.exec, ['load', '-i', file], 'Loading the images failed');
  return m.images[0];
}
