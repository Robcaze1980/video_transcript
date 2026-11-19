import { describe, expect, it } from 'vitest';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertReviewGuard, createReviewHandlerTracker, createReviewResourceJournal, validateReviewEmulators } from './reviewBrowserFixtureBuild.mjs';

describe('synthetic browser fixture safeguards', () => {
  it('rejects a missing clean launcher profile before preparing a manifest', () => {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR; expect(systemRoot).toBeTruthy();
    const dummyProfile = resolve('outputs'), homeDrive = parse(dummyProfile).root.slice(0, 2), systemDrive = parse(systemRoot!).root.slice(0, 2);
    const child = spawnSync(process.execPath, ['scripts/runReviewedTranslationBrowserEmulator.mjs','--prepare'], {
      cwd: resolve('.'), env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: join(systemRoot!, 'System32'),
        USERPROFILE: dummyProfile, APPDATA: dummyProfile, LOCALAPPDATA: dummyProfile, TEMP: dummyProfile, TMP: dummyProfile,
        HOMEDRIVE: homeDrive, HOMEPATH: dummyProfile.slice(2), SYSTEMDRIVE: systemDrive,
        USERNAME: 'synthetic-review', USERDOMAIN: 'SYNTHETIC', LOGONSERVER: 'SYNTHETIC' },
      encoding: 'utf8', timeout: 15_000, windowsHide: true,
    });
    expect(child.status).not.toBe(0); expect(child.stderr).toContain('Invalid synthetic launcher directory');
    expect(child.stdout).not.toContain('Synthetic manifest prepared');
  });
  it('accepts a marked synthetic launcher profile without starting a fixture', () => {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR; expect(systemRoot).toBeTruthy();
    const outputRoot = realpathSync(resolve('outputs')), base = join(outputRoot, 'lv019-b-review-browser-bootstrap');
    if (!existsSync(base)) mkdirSync(base); expect(lstatSync(base).isSymbolicLink()).toBe(false);
    expect(realpathSync(base).toLowerCase()).toBe(base.toLowerCase());
    const boot = join(base, `boot-${randomUUID()}`), profile = join(boot, 'profile'), temp = join(boot, 'temp');
    mkdirSync(boot); mkdirSync(profile); mkdirSync(temp);
    const marker = randomUUID().replaceAll('-', ''), markerFile = join(profile, '.synthetic-bootstrap-owner');
    writeFileSync(markerFile, marker, { flag: 'wx' });
    try {
      const homeDrive = parse(profile).root.slice(0, 2), systemDrive = parse(systemRoot!).root.slice(0, 2);
      const node = 'C:/Users/rob62/AppData/Local/LinguistVision/tools/node-v24.13.0-win-x64/node.exe';
      const child = spawnSync(node, ['scripts/runReviewedTranslationBrowserEmulator.mjs','--check-environment'], {
        cwd: resolve('.'), env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: join(systemRoot!, 'System32'),
          USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile, TEMP: temp, TMP: temp,
          HOMEDRIVE: homeDrive, HOMEPATH: profile.slice(2), SYSTEMDRIVE: systemDrive,
          USERNAME: 'synthetic-review', USERDOMAIN: 'SYNTHETIC', LOGONSERVER: 'SYNTHETIC',
          LV_REVIEW_BROWSER_BOOTSTRAP: boot, LV_REVIEW_BROWSER_BOOTSTRAP_MARKER: marker },
        encoding: 'utf8', timeout: 15_000, windowsHide: true,
      });
      expect(child.status, child.stderr).toBe(0); expect(child.stdout).toContain('no manifest, emulator, or fixture started');
    } finally {
      const actual = realpathSync(boot); expect(actual.toLowerCase()).toBe(resolve(boot).toLowerCase());
      expect(dirname(actual).toLowerCase()).toBe(base.toLowerCase()); expect(basename(actual)).toMatch(/^boot-[a-f0-9-]{36}$/i);
      expect(readFileSync(markerFile, 'utf8')).toBe(marker); rmSync(actual, { recursive: true });
    }
  });
  it('requires the in-process frozen guard and the matching nonce and process', () => {
    const nonce = 'a'.repeat(32), pid = 1234, valid = Object.freeze({ version: 1, nonce, pid });
    expect(() => assertReviewGuard(valid, nonce, pid)).not.toThrow();
    for (const guard of [undefined, { ...valid }, Object.freeze({ ...valid, pid: 456 }), Object.freeze({ ...valid, nonce: 'b'.repeat(32) })]) {
      expect(() => assertReviewGuard(guard, nonce, pid)).toThrow();
    }
  });
  it('keeps handlers active until asynchronous work really settles, including failure', async () => {
    const tracker = createReviewHandlerTracker(); let finish!: () => void;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    const first = tracker.run(async () => { await wait; return 'finished'; });
    const second = tracker.run(async () => { throw Error('synthetic'); });
    expect(tracker.size).toBe(2); await expect(second).rejects.toThrow('synthetic');
    await Promise.resolve(); expect(tracker.size).toBe(1);
    finish(); expect(await first).toBe('finished'); await Promise.resolve(); expect(tracker.size).toBe(0);
  });
  it('flushes planned synthetic resources before an interruption and rejects credential fields', () => {
    const tempRoot = realpathSync(tmpdir()), dir = mkdtempSync(join(tempRoot, 'vistavo-review-inventory-'));
    const marker = randomUUID(), owner = join(dir, '.owner'); writeFileSync(owner, marker, { flag: 'wx' });
    try {
      const file = join(dir, 'resources.ndjson'), journal = createReviewResourceJournal(file);
      journal.append('firestore_root_planned', { path: 'synthetic/root', marker, project: 'demo-vistavo-review-browser' });
      journal.append('auth_user_planned', { uid: 'synthetic-user', email: 'synthetic@example.invalid', marker });
      expect(() => journal.append('auth_user_planned', { password: 'never-store' })).toThrow();
      expect(() => journal.append('auth_user_planned', { token: 'never-store' })).toThrow();
      journal.close();
      const saved = readFileSync(file, 'utf8'); const entries = saved.trim().split('\n').map(line => JSON.parse(line));
      expect(entries.map(entry => entry.kind)).toEqual(['firestore_root_planned','auth_user_planned']);
      expect(entries[0].marker).toBe(marker); expect(entries[1].uid).toBe('synthetic-user');
      expect(saved).not.toContain('never-store'); expect(() => createReviewResourceJournal(file)).toThrow();
    } finally {
      const actual = realpathSync(dir); expect(actual.toLowerCase()).toBe(resolve(dir).toLowerCase());
      expect(dirname(actual).toLowerCase()).toBe(tempRoot.toLowerCase()); expect(basename(actual)).toMatch(/^vistavo-review-inventory-/);
      expect(readFileSync(owner, 'utf8')).toBe(marker); rmSync(actual, { recursive: true });
    }
  });
  it('accepts only the dedicated listeners, reviewed process tree and an idle initial state', () => {
    const expected = { node: 'C:/fixture/node.exe', java: 'C:/fixture/java.exe', cli: 'C:/fixture/firebase.js', jar: 'C:/fixture/firestore.jar', config: 'C:/fixture/config.json' };
    const sample = () => ({ listeners: [{ port: 18766, address: '127.0.0.1', pid: 11 }, { port: 18765, address: '127.0.0.1', pid: 33 }], established: 0,
      processes: [
        { pid: 11, parent: 1, name: 'node.exe', exe: expected.node, created: 't1', projectCli: true, configMatch: true, cliMatch: true },
        { pid: 22, parent: 11, name: 'java.exe', exe: expected.java, created: 't2' },
        { pid: 33, parent: 22, name: 'java.exe', exe: expected.java, created: 't3', projectFirestore: true, jarMatch: true, portMatch: true },
      ] });
    const good = sample(); expect(validateReviewEmulators(good, expected, true)).toMatchObject({ auth: { pid: 11 }, firestore: { pid: 33 } });
    const occupied = sample(); occupied.established = 1; expect(() => validateReviewEmulators(occupied, expected, true)).toThrow();
    const wildcard = sample(); wildcard.listeners[0].address = '0.0.0.0'; expect(() => validateReviewEmulators(wildcard, expected)).toThrow();
    const shared = sample(); shared.listeners[1].port = 8185; expect(() => validateReviewEmulators(shared, expected)).toThrow();
    const foreignConfig = sample(); foreignConfig.processes[0].configMatch = false; expect(() => validateReviewEmulators(foreignConfig, expected)).toThrow();
    const forgedConfig = sample(); (forgedConfig.processes[0] as { configMatch: unknown }).configMatch = 'false'; expect(() => validateReviewEmulators(forgedConfig, expected)).toThrow();
    const unlinked = sample(); unlinked.processes[1].parent = 999; expect(() => validateReviewEmulators(unlinked, expected)).toThrow();
    const wrongJar = sample(); wrongJar.processes[2].jarMatch = false; expect(() => validateReviewEmulators(wrongJar, expected)).toThrow();
    const replaced = sample(); replaced.processes[2].created = 'later';
    expect(validateReviewEmulators(replaced, expected)).not.toEqual(validateReviewEmulators(good, expected));
  });
});
