import {spawnSync} from 'node:child_process';
import {expect, it} from 'vitest';

// These Windows-only fixture checks use node:test, not Vitest. Run them here
// explicitly so the main suite verifies them without loading two test runners
// into the same file. Their temporary data is synthetic and task-scoped.
const windowsOnly = process.platform === 'win32' ? it : it.skip;
windowsOnly('runs the synthetic browser helper checks with the Node test runner', () => {
  const result = spawnSync(process.execPath, [
    '--test', '--test-reporter=tap',
    'scripts/reviewBrowserCacheReuse.node.mjs',
    'scripts/reviewBrowserCacheReuseCli.node.mjs',
    'server/commercial/web/reviewBrowserCdp.node.mjs',
    'server/commercial/web/reviewBrowserBinaryIdentity.node.mjs',
  ], {cwd: process.cwd(), encoding: 'utf8', timeout: 60_000, windowsHide: true, env: {...process.env, NODE_OPTIONS: ''}});

  expect(result.error?.message).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toMatch(/^# tests (?:[8-9]|[1-9]\d+)\s*$/m);
  expect(result.stdout).toMatch(/^# fail 0\s*$/m);
  expect(result.stdout).toMatch(/^# cancelled 0\s*$/m);
  expect(result.stdout).toMatch(/^# skipped 0\s*$/m);
  expect(result.stdout).toMatch(/^# todo 0\s*$/m);
}, 70_000);
