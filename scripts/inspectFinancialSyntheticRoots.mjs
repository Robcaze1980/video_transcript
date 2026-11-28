// Read-only inventory of dedicated demo-emulator roots. It does not inspect
// documents or touch real projects, and does not delete any filesystem paths.
import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';
import { FINANCIAL_ROOT_COLLECTIONS } from '../server/commercial/financialOwnedRootGuard.mjs';

if (process.env.NODE_ENV !== 'test' || process.env.LV_FINANCIAL_REGRESSION !== '1' ||
    process.env.LV_REVIEW_CONTRACT !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8198' ||
    process.env.GOOGLE_CLOUD_PROJECT !== 'demo-vistavo-financial' || process.env.GCLOUD_PROJECT !== 'demo-vistavo-financial' ||
    process.env.METADATA_SERVER_DETECTION !== 'none' || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.NODE_OPTIONS) {
  throw Error('A fixed isolated demo emulator is required');
}
const db = new Firestore({ projectId: 'demo-vistavo-financial', host: '127.0.0.1:8198', ssl: false, preferRest: false });
try {
  const s = db._settings;
  if (db.projectId !== 'demo-vistavo-financial' || db.databaseId !== '(default)' || s?.projectId !== 'demo-vistavo-financial' ||
      s?.servicePath !== '127.0.0.1' || s?.port !== 8198 || s?.ssl !== false ||
      ['auth', 'credentials', 'keyFilename', 'authClient'].some(key => s?.[key] !== undefined)) throw Error('Unexpected client target');
  const collections = {};
  for (const name of FINANCIAL_ROOT_COLLECTIONS) {
    const docs = await db.collection(name).listDocuments();
    if (docs.some(doc => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(doc.id))) throw Error('Unexpected test root');
    collections[name] = docs.map(doc => createHash('sha256').update(doc.id).digest('hex')).sort();
  }
  process.stdout.write(`${JSON.stringify({ version: 1, project: 'demo-vistavo-financial', host: '127.0.0.1:8198', collections })}\n`);
} finally { await db.terminate(); }
