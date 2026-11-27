// Read-only inventory of dedicated demo-emulator roots. It does not inspect
// documents or touch real projects, and does not delete any filesystem paths.
import { createHash } from 'node:crypto';
import { Firestore } from 'firebase-admin/firestore';

if (process.env.NODE_ENV !== 'test' || process.env.LV_FINANCIAL_REGRESSION !== '1' ||
    process.env.LV_REVIEW_CONTRACT !== '1' || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8195' ||
    process.env.GOOGLE_CLOUD_PROJECT !== 'demo-vistavo-applied-owner' || process.env.GCLOUD_PROJECT !== 'demo-vistavo-applied-owner' ||
    process.env.METADATA_SERVER_DETECTION !== 'none' || process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.NODE_OPTIONS) {
  throw Error('A fixed isolated demo emulator is required');
}
const db = new Firestore({ projectId: 'demo-vistavo-applied-owner', host: '127.0.0.1:8195', ssl: false, preferRest: false });
try {
  const s = db._settings;
  if (db.projectId !== 'demo-vistavo-applied-owner' || db.databaseId !== '(default)' || s?.projectId !== 'demo-vistavo-applied-owner' ||
      s?.servicePath !== '127.0.0.1' || s?.port !== 8195 || s?.ssl !== false ||
      ['auth', 'credentials', 'keyFilename', 'authClient'].some(key => s?.[key] !== undefined)) throw Error('Unexpected client target');
  const collections = {};
  for (const name of ['vistavo_applied_owner_ledger_synthetic','vistavo_applied_owner_video_synthetic']) {
    const docs = await db.collection(name).listDocuments();
    if (docs.some(doc => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(doc.id))) throw Error('Unexpected test root');
    collections[name] = docs.map(doc => createHash('sha256').update(doc.id).digest('hex')).sort();
  }
  process.stdout.write(`${JSON.stringify({ version: 1, project: 'demo-vistavo-applied-owner', host: '127.0.0.1:8195', collections })}\n`);
} finally { await db.terminate(); }
