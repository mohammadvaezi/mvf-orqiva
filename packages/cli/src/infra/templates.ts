// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-133 | S15 | v0.1.0] Add infrastructure templates and deploy from a gate ──
//    Why:  `orq infra init` gives a repository the files a deploy needs, as starters a team edits: a
//          Docker Compose file whose secrets are ${VARIABLES} the runner fills in, an OpenTofu starter
//          whose secrets are variables, and ignore rules so state and secret files never reach Git.
//          Nothing secret is ever written here; it is refused if a template would hold one.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface Template {
  path: string;
  text: string;
}

export function infraTemplates(project: string): Template[] {
  const name = project.toLowerCase();
  return [
    {
      path: 'deploy/compose.yaml',
      text: `# ${project}: deployed by the Orqiva runner (orq runner). Secrets come from the environment's
# secrets in Orqiva as variables, e.g. \${DB_PASSWORD}; never write a value into this file.
name: ${name}
services:
  app:
    image: \${APP_IMAGE:-ghcr.io/your-org/${name}:latest}
    restart: unless-stopped
    environment:
      DATABASE_URL: postgres://${name}:\${DB_PASSWORD}@db:5432/${name}
    ports:
      - '\${APP_PORT:-8080}:8080'
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${name}
      POSTGRES_PASSWORD: \${DB_PASSWORD}
      POSTGRES_DB: ${name}
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${name}']
      interval: 5s
      retries: 30
volumes:
  db-data:
`,
    },
    {
      path: 'infra/main.tf',
      text: `# ${project}: an OpenTofu starter. The runner runs tofu init and apply in this folder; each secret of
# the environment arrives as TF_VAR_<name in lower case>, e.g. var.db_password. Add your provider below.
terraform {
  required_version = ">= 1.6"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "environment" {
  type    = string
  default = "staging"
}

# provider "hcloud" { }   # your cloud's provider; its token is a secret of the environment too

output "environment" {
  value = var.environment
}
`,
    },
    {
      path: 'infra/.gitignore',
      text: '.terraform/\n*.tfstate\n*.tfstate.*\n*.tfvars\ncrash.log\n',
    },
    {
      path: 'deploy/.gitignore',
      text: '.env\n.env.*\n',
    },
    {
      path: 'deploy/README.md',
      text: `# Deploying ${project}

Orqiva deploys this project through a runner (\`orq runner\`) on a machine that can reach the target.

1. In Orqiva, open the project's Environments and add one (e.g. staging), with its target and health URL.
2. Add its secrets there (DB_PASSWORD, …). They are stored encrypted and reach only the runner, as
   variables; this folder never holds them.
3. Start a runner where the deploy should happen: \`orq runner --server <url> --token <runner token>\`.
4. Press Deploy, or let a gate do it: an environment that deploys on G1 goes live when G1 is signed.
`,
    },
  ];
}

const SECRET_VALUE = /(password|secret|token)\s*[:=]\s*['"]?(?!\$\{)[A-Za-z0-9+/_-]{6,}/i;

/** True when a template text holds what looks like a secret value instead of a ${VARIABLE}. */
export const holdsSecret = (text: string): boolean => SECRET_VALUE.test(text);

/** Writes the templates into the repository; existing files are kept unless forced. */
export function writeTemplates(
  root: string,
  project: string,
  force = false,
): { written: string[]; kept: string[] } {
  const written: string[] = [];
  const kept: string[] = [];
  for (const t of infraTemplates(project)) {
    if (holdsSecret(t.text)) throw new Error('A template holds a secret: ' + t.path);
    const file = join(root, t.path);
    if (existsSync(file) && !force) {
      kept.push(t.path);
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, t.text);
    written.push(t.path);
  }
  return { written, kept };
}
