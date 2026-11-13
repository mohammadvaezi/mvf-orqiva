// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-75 | S14 | v0.1.0] Package the toolchain as a Windows installer bundle ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/
//    Why:  the installer is PowerShell, so it is not covered by anything else in this suite. What is
//          asserted here is the part that would be unrecoverable rather than merely broken: a bundle
//          that carries a credential, or a key that reaches a command line. The build script refuses
//          both at build time; these tests make sure the refusals are still in it.
// ── [PCODE-76 | S08 | v0.1.0] Turn the setup into a Windows wizard that installs VS Code, Claude Code and all prerequisites ──
//    Why:  the wizard is the second way a key could leak (its own command lines) and the way an empty
//          .exe once shipped; both are pinned here.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const INSTALL = read('installer/Install-Orqiva.ps1');
const UNINSTALL = read('installer/Uninstall-Orqiva.ps1');
const BUILD = read('tools/build-installer.ps1');
const WIZARD = read('installer/Orqiva.iss');
const PREREQ = read('installer/Install-Prerequisite.ps1');

/** the script without its comments: a rule about what the code does must not be met by prose saying so */
const code = (text: string): string =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
const INSTALL_CODE = code(INSTALL);

describe('the bundle can never carry a credential', () => {
  it('the build script excludes the secret store and refuses to zip one it finds', () => {
    expect(BUILD).toContain("'secrets.bin'");
    expect(BUILD).toContain('$ForbiddenNames');
    expect(BUILD).toContain('plane_api_[0-9a-f]{32}');
    expect(BUILD).toMatch(/throw 'The bundle contains something credential-shaped/);
  });

  it('the installer refuses a bundle that has one anyway', () => {
    expect(INSTALL).toMatch(/Refusing to install: the bundle contains/);
  });
});

// ── [PCODE-75 | S14 | v0.1.0] the key never reaches a command line ──
describe('the key', () => {
  it('is read as a SecureString and handed to Python on stdin', () => {
    expect(INSTALL).toContain('-AsSecureString');
    expect(INSTALL).toContain('sys.stdin.readline()');
    // install.py accepts --key; using it would put the value in the process list
    expect(INSTALL_CODE).not.toMatch(/install\.py.*--key/);
    expect(INSTALL_CODE).not.toMatch(/--key\s+\$/);
  });

  it('frees the decrypted copy and deletes the helper script afterwards', () => {
    expect(INSTALL).toContain('ZeroFreeBSTR');
    expect(INSTALL).toMatch(/Remove-Item \$script -Force/);
  });

  it('is never written to the console or a log by the installer', () => {
    for (const line of INSTALL.split('\n')) {
      if (/Write-Host|Say |Ok |Warn2 /.test(line)) {
        expect(line, line.trim()).not.toMatch(/\$plain|\$secure|PLANE_API_KEY/);
      }
    }
  });
});

describe('the installer stays inside this user', () => {
  it('installs under LOCALAPPDATA and never asks for elevation', () => {
    expect(INSTALL).toContain("Join-Path $env:LOCALAPPDATA 'Orqiva'");
    expect(INSTALL).not.toMatch(/RunAs|-Verb\s+runas|Program Files'\s*\)/);
  });

  it('supports a dry run and installs nothing without being asked', () => {
    expect(INSTALL).toContain('SupportsShouldProcess = $true');
    expect(INSTALL).toContain('$PSCmdlet.ShouldProcess');
    // [PCODE-76 | S08 | v0.1.0] a prerequisite is only installed after a yes
    expect(INSTALL).toMatch(/Install \$Label now\? \[y\/N\]/);
  });
});

describe('the uninstaller removes what was added and nothing else', () => {
  it('asks about the stored key separately', () => {
    expect(UNINSTALL).toMatch(/Remove the stored Plane key from this machine too\? \[y\/N\]/);
    expect(UNINSTALL).toContain('KeepCredentials');
  });

  it('keeps other people’s hooks, settings and repositories', () => {
    expect(UNINSTALL).toContain("_.command -notmatch 'hooks\\.py'");
    expect(UNINSTALL).toMatch(/everything else in settings\.json was kept/);
    expect(UNINSTALL).toMatch(/\.plane\/ folder in your repositories was left alone/);
  });

  it('takes only its own entry off the PATH', () => {
    expect(UNINSTALL).toContain("$_.TrimEnd('\\') -ne $binDir.TrimEnd('\\')");
  });

  it('is a dry run away from being safe to inspect', () => {
    expect(UNINSTALL).toContain('SupportsShouldProcess = $true');
  });
});

describe('the bundle a second machine receives', () => {
  it('has the pieces an empty machine needs', () => {
    for (const rel of [
      'installer/Setup.bat',
      'installer/Uninstall.bat',
      'installer/Install-Orqiva.ps1',
      'installer/Uninstall-Orqiva.ps1',
      'tools/build-installer.ps1',
      'installer/Orqiva.iss',
      'installer/Install-Prerequisite.ps1',
    ]) {
      expect(fs.existsSync(path.join(ROOT, rel)), rel).toBe(true);
    }
  });

  it('carries the documents, not only the programs', () => {
    for (const doc of ['install.md', 'guide.md', 'release.md', 'known-issues.md']) {
      expect(BUILD, doc).toContain(doc);
    }
    expect(BUILD).toContain('LICENSE');
  });

  it('is launched by a .bat, because a .ps1 opens Notepad when double-clicked', () => {
    const bat = read('installer/Setup.bat');
    expect(bat).toContain('-ExecutionPolicy Bypass');
    // scoped to the one process; the machine's policy is not touched
    expect(bat).not.toMatch(/Set-ExecutionPolicy/);
  });
});

// ── [PCODE-76 | S08 | v0.1.0] the setup wizard ──
describe('the setup wizard', () => {
  it('compiles the staged bundle in, and an empty one fails the build', () => {
    expect(WIZARD).toContain('Source: "{#BundleDir}\\*"');
    // {tmp} is a run-time folder; at compile time it silently matched nothing
    expect(WIZARD).not.toMatch(/Source:.*\{tmp\}/);
    expect(WIZARD).not.toMatch(/^Source:.*skipifsourcedoesntexist/m);
    expect(BUILD).toContain('"/DBundleDir=$stage"');
  });

  it('hands the key over in the environment, never on a command line, and clears it', () => {
    expect(WIZARD).toContain("SetEnvironmentVariable('PLANE_API_KEY', Key)");
    expect(WIZARD).toContain("DeleteEnvironmentVariable('PLANE_API_KEY', 0)");
    expect(WIZARD).not.toMatch(/-PlaneKey|--key|Values\[2\]\s*\+/);
    // the key field is masked
    expect(WIZARD).toContain("PlanePage.Add('API key:', True)");
  });

  it('runs the same PowerShell installer, hidden and logged, without prompting', () => {
    expect(WIZARD).toContain("'Install-Orqiva.ps1'");
    expect(WIZARD).toContain('-NonInteractive -SkipPrerequisites');
    expect(WIZARD).toContain('SW_HIDE');
    expect(INSTALL).toContain('Start-Transcript');
  });

  it('offers every tool a fresh machine lacks, and only those', () => {
    for (const tool of ['node', 'git', 'python', 'vscode', 'claude']) {
      expect(WIZARD, tool).toContain(`Check: IsMissing('${tool}')`);
      expect(PREREQ, tool).toContain(`'${tool}'`);
    }
  });

  it('stays in this user and never asks for elevation itself', () => {
    expect(WIZARD).toContain('PrivilegesRequired=lowest');
    expect(WIZARD).not.toContain('PrivilegesRequiredOverridesAllowed');
    expect(PREREQ).not.toMatch(/-Verb\s+runas/i);
    expect(PREREQ).toContain("'--scope', $scope");
  });
});
