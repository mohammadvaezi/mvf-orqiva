// ── [PCODE-51 | S10 | v0.1.0] Build the Docker panel with generate, build, run, stop, logs and health ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  what the Docker panel may offer is a matrix, not a feeling: no Docker means nothing but the
//          download link, no Dockerfile means no Build, no compose file means no Run, nothing running means
//          no Stop and no Logs. The matrix lives here, pure, so it is tested rather than clicked.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  composePs,
  imageTag,
  version as dockerVersion,
  type ComposeService,
  type DockerOptions,
  type DockerVersion,
} from './docker';

/** the compose file names docker itself looks for, in its own order */
export const COMPOSE_NAMES = [
  'compose.yaml',
  'compose.yml',
  'docker-compose.yaml',
  'docker-compose.yml',
] as const;
/** and the folders a monorepo keeps them in - letterman's Makefile points at infra/docker-compose.yml */
export const COMPOSE_DIRS = ['', 'infra', 'docker', 'deploy', 'ops'] as const;
export const DOCKERFILE = 'Dockerfile';

export interface DockerButtons {
  generate: boolean;
  build: boolean;
  run: boolean;
  stop: boolean;
  logs: boolean;
  health: boolean;
}

export interface DockerState {
  version: DockerVersion;
  hasDockerfile: boolean;
  /** the Dockerfile found, relative to the root */
  dockerfile: string | null;
  /** the compose file found in the project, relative to the root; null when there is none */
  composeFile: string | null;
  image: string;
  services: ComposeService[];
  running: boolean;
  filesNote: string;
  buttons: DockerButtons;
}

export interface StateIo {
  existsSync: (p: string) => boolean;
}

const defaultIo: StateIo = { existsSync: (p) => fs.existsSync(p) };

// -- [PCODE-51 | S10 | v0.1.0] findComposeFile: the root first, then the folders a monorepo uses --
export function findComposeFile(root: string, io: StateIo = defaultIo): string | null {
  for (const dir of COMPOSE_DIRS)
    for (const name of COMPOSE_NAMES) {
      const rel = dir ? dir + '/' + name : name;
      if (io.existsSync(path.join(root, ...rel.split('/')))) return rel;
    }
  return null;
}

/** the Dockerfile to build: the root one, else one in the same conventional folders */
export function findDockerfile(root: string, io: StateIo = defaultIo): string | null {
  for (const dir of COMPOSE_DIRS) {
    const rel = dir ? dir + '/' + DOCKERFILE : DOCKERFILE;
    if (io.existsSync(path.join(root, ...rel.split('/')))) return rel;
  }
  return null;
}

// ── [PCODE-51 | S10 | v0.1.0] filesNote: what the panel says about Dockerfile and compose ──
export function filesNote(dockerfile: string | null, composeFile: string | null): string {
  if (dockerfile && composeFile) return `${dockerfile} · ${composeFile}`;
  if (!dockerfile && !composeFile) return 'No Dockerfile and no compose file yet.';
  return dockerfile
    ? `${dockerfile}, but no compose file yet.`
    : `${composeFile ?? ''}, but no Dockerfile yet.`;
}

// ── [PCODE-51 | S10 | v0.1.0] buttonsFor: the matrix ──
export function buttonsFor(input: {
  dockerOk: boolean;
  hasDockerfile: boolean;
  composeFile: string | null;
  running: boolean;
  busy: boolean;
}): DockerButtons {
  const free = !input.busy;
  const docker = input.dockerOk && free;
  return {
    // generating the files needs Claude, not Docker
    generate: free && !(input.hasDockerfile && input.composeFile !== null),
    build: docker && input.hasDockerfile,
    run: docker && input.composeFile !== null,
    stop: docker && input.composeFile !== null && input.running,
    logs: docker && input.composeFile !== null && input.running,
    health: docker && input.running,
  };
}

export interface ReadStateInput {
  root: string;
  projectName: string;
  version: string;
  io?: StateIo;
  docker?: Omit<DockerOptions, 'cwd'>;
  busy?: boolean;
}

// ── [PCODE-51 | S10 | v0.1.0] readDockerState: one look at the machine and the project ──
export async function readDockerState(input: ReadStateInput): Promise<DockerState> {
  const io = input.io ?? defaultIo;
  const opts: DockerOptions = { cwd: input.root, ...input.docker };
  const version = await dockerVersion(opts);
  const dockerfile = findDockerfile(input.root, io);
  const hasDockerfile = dockerfile !== null;
  const composeFile = findComposeFile(input.root, io);
  const services = version.ok && composeFile ? await composePs(composeFile, opts) : [];
  const running = services.some((s) => /running|restarting/i.test(s.state));
  return {
    version,
    hasDockerfile,
    dockerfile,
    composeFile,
    image: imageTag(input.projectName, input.version),
    services,
    running,
    filesNote: filesNote(dockerfile, composeFile),
    buttons: buttonsFor({
      dockerOk: version.ok,
      hasDockerfile,
      composeFile,
      running,
      busy: input.busy ?? false,
    }),
  };
}

export function describeService(s: ComposeService): string {
  const health = s.health && s.health !== 'none' ? ` · ${s.health}` : '';
  return `${s.service || s.name}: ${s.state}${health}`;
}
