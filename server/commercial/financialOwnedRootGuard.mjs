// Synthetic financial regression only. This module must not be imported by product code.
import assert from 'node:assert/strict';

export const FINANCIAL_PROJECT = 'demo-vistavo-financial';
export const FINANCIAL_HOST = '127.0.0.1:8198';
export const FINANCIAL_ROOT_COLLECTIONS = Object.freeze([
  'vistavo_a3_exit_ledger_synthetic', 'vistavo_a3_exit_video_synthetic', 'vistavo_account_test',
  'vistavo_ack_window_ledger_synthetic', 'vistavo_ack_window_video_synthetic',
  'vistavo_age_escalation_ledger_synthetic', 'vistavo_age_escalation_video_synthetic',
  'vistavo_ai_backend_test', 'vistavo_ai_integration_test', 'vistavo_backend_test',
  'vistavo_blocks_a_ledger_synthetic', 'vistavo_blocks_a_video_synthetic',
  'vistavo_drain_control_ledger_synthetic', 'vistavo_drain_control_video_synthetic',
  'vistavo_drain_section_ledger_synthetic', 'vistavo_drain_section_video_synthetic',
  'vistavo_unblock_ledger_synthetic', 'vistavo_unblock_video_synthetic',
  'vistavo_video_c2a_settlement_ledger_synthetic', 'vistavo_video_c2a_settlement_video_synthetic',
  'vistavo_video_unknown_resolver_ledger_synthetic', 'vistavo_video_unknown_resolver_video_synthetic',
]);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function assertScope(db, root, marker) {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.LV_REVIEW_CONTRACT, '1');
  assert.equal(process.env.LV_FINANCIAL_REGRESSION, '1');
  assert.equal(process.env.METADATA_SERVER_DETECTION, 'none');
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, FINANCIAL_HOST);
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, FINANCIAL_PROJECT);
  assert.equal(process.env.GCLOUD_PROJECT, FINANCIAL_PROJECT);
  for (const key of ['HOME', 'CODEX_HOME', 'NODE_OPTIONS', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_API_KEY',
    'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'K_SERVICE', 'FUNCTION_TARGET']) {
    assert.equal(process.env[key], undefined, `Unexpected ${key}`);
  }
  const settings = db?._settings;
  assert.equal(db?.projectId, FINANCIAL_PROJECT);
  assert.equal(db?.databaseId, '(default)');
  assert.equal(settings?.projectId, FINANCIAL_PROJECT);
  assert.equal(settings?.servicePath, '127.0.0.1');
  assert.equal(settings?.port, 8198);
  assert.equal(settings?.ssl, false);
  assert.ok(settings?.preferRest === undefined || settings.preferRest === false);
  for (const key of ['auth', 'credentials', 'keyFilename', 'authClient']) assert.equal(settings?.[key], undefined);
  assert.equal(root?.firestore, db);
  const [collection, id, ...rest] = String(root?.path ?? '').split('/');
  assert.equal(rest.length, 0);
  assert.ok(FINANCIAL_ROOT_COLLECTIONS.includes(collection));
  assert.match(id ?? '', uuid);
  assert.equal(root.parent?.path, collection);
  assert.ok(marker && typeof marker === 'object' && !Array.isArray(marker));
  assert.equal(typeof marker.purpose, 'string');
  assert.ok(marker.purpose.includes('synthetic'));
  assert.match(String(marker.nonce ?? marker.marker ?? ''), uuid);
  if (marker.project !== undefined) assert.equal(marker.project, FINANCIAL_PROJECT);
}

export async function prepareFinancialOwnedRoot(db, root, marker) {
  assertScope(db, root, marker);
  assert.equal((await root.get()).exists, false);
  assert.deepEqual(await root.listCollections(), []);
  await root.create(marker);
  assert.deepEqual((await root.get()).data(), marker);
}

export async function assertFinancialOwnedRoot(db, root, marker) {
  assertScope(db, root, marker);
  const row = await root.get();
  assert.equal(row.exists, true);
  assert.deepEqual(row.data(), marker);
}

export async function deleteFinancialOwnedRoot(db, root, marker) {
  await assertFinancialOwnedRoot(db, root, marker);
  await db.recursiveDelete(root);
  assert.equal((await root.get()).exists, false);
  assert.deepEqual(await root.listCollections(), []);
}
