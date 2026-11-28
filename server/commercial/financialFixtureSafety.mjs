import assert from 'node:assert/strict';
import {deleteFinancialOwnedRoot} from './financialOwnedRootGuard.mjs';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const isolated = process.env.LV_FINANCIAL_REGRESSION === '1';
const allowedCollections = new Set(['vistavo_backend_test', 'vistavo_ai_backend_test', 'vistavo_ai_integration_test']);

function assertTarget(c, collection) {
  if (!isolated) return;
  assert.ok(allowedCollections.has(collection));
  assert.equal(process.platform, 'win32'); assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.env.LV_REVIEW_CONTRACT, '1'); assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8198');
  assert.equal(process.env.GOOGLE_CLOUD_PROJECT, 'demo-vistavo-financial'); assert.equal(process.env.GCLOUD_PROJECT, 'demo-vistavo-financial');
  assert.equal(process.env.METADATA_SERVER_DETECTION, 'none');
  for (const name of ['HOME', 'CODEX_HOME', 'NODE_OPTIONS', 'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'K_SERVICE', 'FUNCTION_TARGET']) assert.ok(!process.env[name]);
  const profile = process.env.APPDATA; assert.ok(profile && profile === process.env.USERPROFILE && profile === process.env.LOCALAPPDATA);
  const actual = resolve(profile), base = resolve('outputs/lv019-b-financial-runs'), parts = relative(base, actual).split(sep);
  assert.equal(parts.length, 2); assert.match(parts[0], /^run-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/); assert.equal(parts[1], 'profile');
  assert.equal(realpathSync(actual).toLowerCase(), actual.toLowerCase()); assert.equal(existsSync(join(actual, 'gcloud', 'application_default_credentials.json')), false);
  assert.match(c.root.path, new RegExp(`^${collection}/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$`));
  const settings = c.db._settings;
  assert.equal(c.db.projectId, 'demo-vistavo-financial'); assert.equal(c.db.databaseId, '(default)');
  assert.equal(settings?.projectId, 'demo-vistavo-financial'); assert.equal(settings?.servicePath, '127.0.0.1');
  assert.equal(settings?.port, 8198); assert.equal(settings?.ssl, false); assert.equal(settings?.preferRest, false);
  for (const field of ['auth', 'credentials', 'keyFilename', 'authClient']) assert.equal(settings?.[field], undefined);
}

/** Call only after putting the context in afterEach's cleanup list. */
export async function prepareFinancialFixture(c, collection) {
  if (!isolated) return;
  assertTarget(c, collection); c.marker = randomUUID(); c.confirmed = false;
  assert.equal((await c.root.get()).exists, false); assert.deepEqual(await c.root.listCollections(), []);
  await c.root.create({ marker: c.marker, purpose: 'financial-regression-synthetic-v1' });
  const marker = await c.root.get();
  assert.equal(marker.get('marker'), c.marker); assert.equal(marker.get('purpose'), 'financial-regression-synthetic-v1'); c.confirmed = true;
}

/** Never recursively delete an unconfirmed, mismatched or out-of-scope root. */
export async function cleanupFinancialFixture(c, collection) {
  if (!isolated) throw Error('Dedicated financial regression environment required for cleanup');
  assertTarget(c, collection); const marker = await c.root.get();
  if (!c.confirmed) {
    assert.equal(marker.exists, false, 'Unconfirmed root is preserved for inspection');
    assert.deepEqual(await c.root.listCollections(), []); return;
  }
  assert.equal(marker.exists, true); assert.equal(marker.get('marker'), c.marker);
  assert.equal(marker.get('purpose'), 'financial-regression-synthetic-v1');
  await deleteFinancialOwnedRoot(c.db,c.root,{ marker:c.marker, purpose:'financial-regression-synthetic-v1' }); assert.equal((await c.root.get()).exists, false); assert.deepEqual(await c.root.listCollections(), []);
}
