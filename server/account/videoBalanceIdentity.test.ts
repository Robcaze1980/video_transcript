import { describe, expect, it } from 'vitest';
import { AccountFault, AccountStore } from './backend';

// In-memory optimistic transaction model, using invented records only. It can
// demonstrate the application's read pattern and a retry, but does not replace
// a Firestore Emulator test or prove production isolation/permissions.
type Row = Record<string, unknown>;
type Ref = { path: string; get: () => Promise<Snapshot> };
type Snapshot = { exists: boolean; get: (name: string) => unknown; data: () => Row | undefined };
const uid = 'synthetic-video-balance-owner';
const accountA = '10000000-0000-4000-8000-000000000001';
const accountB = '10000000-0000-4000-8000-000000000002';
const otherKey = 'b'.repeat(64);
const accountRow = (identityKey: string, credited: number, available: number, reserved: number): Row => ({
  identityKey, schemaVersion: 1, unit: 'video_seconds', credited, available, reserved, consumed: 0,
  active: reserved ? 1 : 0, activeProjectCount: 0, createdAtMs: 1,
});

function fixture() {
  const identityKey = AccountStore.identityKey(uid), identityPath = `identities/${identityKey}`;
  const rows = new Map<string, Row>([
    [identityPath, { uid, accountId: accountA }],
    [`accounts/${accountA}`, accountRow(identityKey, 10, 8, 2)],
    [`accounts/${accountB}`, accountRow(otherKey, 19, 19, 0)],
  ]);
  const versions = new Map<string, number>(Array.from(rows.keys(), key => [key, 1]));
  let identityHook: (() => void) | undefined, transactions = 0, attempts = 0;
  const write = (path: string, value?: Row) => {
    if (value) rows.set(path, structuredClone(value)); else rows.delete(path);
    versions.set(path, (versions.get(path) ?? 0) + 1);
  };
  const capture = (path: string) => {
    const value = rows.get(path), copy = value ? structuredClone(value) : undefined;
    const snapshot: Snapshot = { exists: copy !== undefined, get: name => copy?.[name], data: () => copy };
    return { snapshot, version: versions.get(path) ?? 0 };
  };
  const root = { collection: (collection: string) => ({ doc: (id: string): Ref => {
    const path = `${collection}/${id}`;
    return { path, get: async () => {
      const value = capture(path);
      if (path === identityPath && identityHook) { const hook = identityHook; identityHook = undefined; hook(); }
      return value.snapshot;
    } };
  } }) };
  const db = { runTransaction: async (fn: (tx: { get: (ref: Ref) => Promise<Snapshot> }) => Promise<unknown>) => {
    transactions++;
    for (let retry = 0; retry < 3; retry++) {
      attempts++;
      const readVersions = new Map<string, number>();
      const tx = { get: async (ref: Ref) => {
        const value = capture(ref.path); readVersions.set(ref.path, value.version);
        if (ref.path === identityPath && identityHook) { const hook = identityHook; identityHook = undefined; hook(); }
        return value.snapshot;
      } };
      const result = await fn(tx);
      if ([...readVersions].every(([path, version]) => (versions.get(path) ?? 0) === version)) return result;
    }
    throw Error('synthetic transaction retry limit');
  } };
  const store = new AccountStore(db as never, root as never);
  return { store, identityKey, identityPath, write, rows, transactions: () => transactions, attempts: () => attempts,
    onIdentityRead: (hook: () => void) => { identityHook = hook; } };
}

describe('Account video balance identity and account consistency', () => {
  it('reads an authorized balance coherently without changing it', async () => {
    const f = fixture();
    expect(await f.store.videoBalance(f.identityKey)).toEqual({ unit: 'video_seconds', credited: 10,
      available: 8, reserved: 2, consumed: 0, active: 1 });
    expect(f.transactions()).toBe(1);
  });

  for (const mutation of ['removed', 'other-account', 'changed-uid'] as const) {
    it(`does not return the old account after identity is ${mutation} between reads`, async () => {
      const f = fixture();
      f.onIdentityRead(() => {
        if (mutation === 'removed') f.write(f.identityPath);
        else if (mutation === 'other-account') f.write(f.identityPath, { uid, accountId: accountB });
        else f.write(f.identityPath, { uid: 'synthetic-other', accountId: accountA });
      });
      await expect(f.store.videoBalance(f.identityKey)).rejects.toBeInstanceOf(AccountFault);
      expect(f.attempts()).toBeGreaterThanOrEqual(2);
    });
  }

  it('does not return the old balance if the identity moves to a coherent replacement account', async () => {
    const f = fixture(); f.write(`accounts/${accountB}`, accountRow(f.identityKey, 19, 19, 0));
    f.onIdentityRead(() => f.write(f.identityPath, { uid, accountId: accountB }));
    const result = await f.store.videoBalance(f.identityKey);
    expect(result).toEqual({ unit: 'video_seconds', credited: 19, available: 19, reserved: 0, consumed: 0, active: 0 });
    expect(f.attempts()).toBeGreaterThanOrEqual(2);
  });

  it('rejects an identity absent before the read without fabricating an account', async () => {
    const f = fixture(); f.write(f.identityPath);
    await expect(f.store.videoBalance(f.identityKey)).rejects.toMatchObject({ code: 'account_not_provisioned' });
    expect(f.rows.has(f.identityPath)).toBe(false);
  });

  it('rejects a mismatched identity key and malformed balance', async () => {
    const f = fixture(); f.write(f.identityPath, { uid: 'synthetic-other', accountId: accountA });
    await expect(f.store.videoBalance(f.identityKey)).rejects.toMatchObject({ code: 'invariant' });
    f.write(f.identityPath, { uid, accountId: accountA });
    f.write(`accounts/${accountA}`, accountRow(f.identityKey, 10, 9, 2));
    await expect(f.store.videoBalance(f.identityKey)).rejects.toMatchObject({ code: 'invariant' });
  });
});
