// ── [PCODE-192 | S15 | v0.1.0] Rebrand ProdEngine and PlaneCode to Orqiva everywhere, with compatibility for existing installs ──
// ── [PCODE-1 | S01 | v0.1.0] Scaffold the extension repo: manifest, esbuild bundle, tsconfig, lint and format ──
// ── [PCODE-4 | S01 | v0.1.0] Add the @vscode/test-electron activation smoke test with a fixture workspace ──
//    Task: https://plan.broszio.com/prodsystem/projects/74f47636-71b0-4eb5-94b5-ea2fe840ec01/issues/c2a0a9f5-2f43-4f7f-b5c0-1d0b4f2b7b01/
//    Why:  downloads VS Code stable once (cached in .vscode-test/) and runs the mocha suite on the fixture
//          workspace with a clean profile; the guard for criticals #10 (activation fast and offline).
import { runTests } from '@vscode/test-electron';
import * as path from 'node:path';

// ── [PCODE-4 | S01 | v0.1.0] main: extensionDevelopmentPath = repo root, tests = dist/test/suite ──
async function main(): Promise<void> {
  const root = path.resolve(__dirname, '..', '..');
  // ── [PCODE-61 | S12 | v0.1.0] the suite can be pointed at a copy of the fixture, which is how a path
  //    with a space and an umlaut is exercised without a second copy of the tests ──
  const workspace =
    process.env['ORQIVA_TEST_WORKSPACE'] ?? path.join(root, 'test', 'fixtures', 'workspace');
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'dist', 'test', 'suite'),
    launchArgs: [workspace, '--disable-extensions', '--disable-workspace-trust', '--profile-temp'],
    // ── [PCODE-63 | S12 | v0.1.0] the developer machine's engine must not leak into the host ──
    //    PLANE_CLAUDE_HOME is set by the engine's installer, so on a developer's machine the "no engine
    //    configured" scenario would silently find a real one - and a test would drive it.
    extensionTestsEnv: { ORQIVA_TEST: '1', PLANE_CLAUDE_HOME: '' },
  });
}

main().catch((err: unknown) => {
  console.error('e2e failed:', err);
  process.exit(1);
});
