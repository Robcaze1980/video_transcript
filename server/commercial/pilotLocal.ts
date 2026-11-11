import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { additionalPilotBetaDirections, pilotLanguageDirections } from '../../config/pilotLanguageDirections';
import { pdfToCsv } from './pdfToCsv';
import { startPilot, type PilotService } from './pilotHttp';
import { createPayPalSandbox, createSimulatedPayments } from './pilotPayments';
import { createPilotVideoAdapter } from './pilotVideo';
import { createLocalWordTiming } from './pilotWordTiming';
import type { FirebaseWebConfig } from './firebaseAccess';
import { PrivateFileStore } from './privateFileStore';
import { ResumableUploads } from './resumableUploads';

async function main() {
  const connectionString = process.env.LINGUISTVISION_PILOT_DATABASE_URL;
  const invitation = process.env.LINGUISTVISION_PILOT_INVITATION;
  const accountId = process.env.LINGUISTVISION_PILOT_ACCOUNT_ID;
  const testKey = process.env.LINGUISTVISION_PILOT_PAYPAL_CLIENT_ID;
  const testSecret = process.env.LINGUISTVISION_PILOT_PAYPAL_CLIENT_SECRET;
  const testMerchant = process.env.LINGUISTVISION_PILOT_PAYPAL_MERCHANT_ID;
  const usePayPalWebSdk = process.env.LINGUISTVISION_PILOT_PAYPAL_WEB_SDK === '1';
  const useGemini = process.env.LINGUISTVISION_PILOT_USE_GEMINI === '1';
  const experimentalLanguages = process.env.LINGUISTVISION_PILOT_EXPERIMENTAL_LANGUAGES === '1';
  const previewLaunchLanguages = process.env.LINGUISTVISION_PILOT_LAUNCH_LANGUAGES === '1';
  const previewConversionAttribution = process.env.LINGUISTVISION_PILOT_CONVERSION_PREVIEW === '1';
  const commercialPreview = process.env.LINGUISTVISION_COMMERCIAL_PREVIEW === '1';
  const outbox = process.env.LINGUISTVISION_COMMERCIAL_OUTBOX;
  const firebaseRaw = process.env.LINGUISTVISION_FIREBASE_WEB_CONFIG;
  const firebaseProject = process.env.LINGUISTVISION_FIREBASE_PROJECT_ID;
  const firebaseWeb: FirebaseWebConfig | undefined = commercialPreview && firebaseRaw ? JSON.parse(firebaseRaw) : undefined;
  if (commercialPreview && Boolean(firebaseRaw) !== Boolean(firebaseProject)) throw new Error('Configure both LinguistVision Firebase settings.');
  if (firebaseWeb && firebaseWeb.projectId !== firebaseProject) throw new Error('Firebase project configuration does not match.');
  const firebase = firebaseWeb ? { web: firebaseWeb } : undefined;
  const privateStorage = process.env.LINGUISTVISION_PRIVATE_STORAGE_DIR;
  if (privateStorage && !isAbsolute(privateStorage)) throw new Error('Private storage requires an absolute path outside the repository.');
  const supabaseUrl = process.env.LINGUISTVISION_SUPABASE_URL;
  const supabaseKey = process.env.LINGUISTVISION_SUPABASE_PUBLISHABLE_KEY;
  if (commercialPreview && Boolean(supabaseUrl) !== Boolean(supabaseKey)) {
    throw new Error('Configure both LinguistVision Supabase Auth values.');
  }
  const supabase = commercialPreview && supabaseUrl && supabaseKey ? { url: supabaseUrl, publishableKey: supabaseKey } : undefined;
  if (firebase && supabase) throw new Error('Configure one identity provider for LinguistVision.');
  const commercialSchema = firebase ? 'lv_commercial_firebase_dev' : supabase ? 'lv_commercial_auth' : 'lv_commercial_minutes';
  const schema = commercialPreview ? commercialSchema + (testKey ? '_sandbox' : '')
    : previewConversionAttribution ? 'lv_private_pilot_conversion_preview' : 'lv_private_pilot_paypal_v2';
  const geminiKey = process.env.GEMINI_API_KEY;
  const timingPython = process.env.LINGUISTVISION_PILOT_WORD_TIMING_PYTHON;
  const timingModel = process.env.LINGUISTVISION_PILOT_WORD_TIMING_MODEL;
  if (!connectionString || (!commercialPreview && (!invitation || invitation.length < 24 || !accountId ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(accountId)))) {
    throw new Error('Configure the pilot database, invitation and account ID.');
  }
  const database = new URL(connectionString);
  if (!['postgresql:', 'postgres:'].includes(database.protocol) || database.hostname !== '127.0.0.1' ||
      !database.port || database.port === '5432' || database.search || database.hash) {
    throw new Error('The private pilot requires a dedicated PostgreSQL database on a non-default loopback port.');
  }
  if ([testKey, testSecret, testMerchant].some(Boolean) && !(testKey && testSecret && testMerchant)) {
    throw new Error('Configure the PayPal Sandbox credentials and merchant ID together.');
  }
  if (previewConversionAttribution && (testKey || process.env.LINGUISTVISION_PILOT_PRIVATE_ORIGIN ||
      process.env.LINGUISTVISION_PILOT_PROXY_HOST)) {
    throw new Error('The conversion preview requires loopback and simulated payments.');
  }
  if (commercialPreview && ((!firebase && !supabase && (!outbox || !isAbsolute(outbox))) || (!firebase &&
      (process.env.LINGUISTVISION_PILOT_PRIVATE_ORIGIN || process.env.LINGUISTVISION_PILOT_PROXY_HOST)))) {
    throw new Error('The commercial preview requires loopback and an absolute local test mailbox.');
  }
  if (commercialPreview && !firebase && !supabase && outbox) await mkdir(outbox, { recursive: true, mode: 0o700 });
  if (useGemini && !geminiKey) throw new Error('Configure the Gemini key before enabling transcription.');
  if ((timingPython || timingModel) && (!timingPython || !timingModel ||
      !isAbsolute(timingPython) || !isAbsolute(timingModel))) {
    throw new Error('Configure absolute paths for the optional word timing worker.');
  }

  const services: PilotService[] = commercialPreview ? [] : [{
    adapter: pdfToCsv, label: 'Extraer texto de PDF a CSV', accepts: '.pdf,application/pdf',
    filename: 'texto.csv', contentType: 'text/csv; charset=utf-8',
  }];
  if (useGemini && geminiKey) {
    const directions = [
      ...pilotLanguageDirections.filter(direction => experimentalLanguages || !direction.experimental),
      ...(previewLaunchLanguages ? additionalPilotBetaDirections : []),
    ];
    services.unshift({
      adapter: createPilotVideoAdapter(geminiKey, directions,
        process.env.LINGUISTVISION_PILOT_MEASURE_USAGE === '1'
          ? event => console.log(JSON.stringify({ type: 'gemini-usage', ...event })) : undefined,
        timingPython && timingModel ? {
          read: createLocalWordTiming(timingPython, timingModel),
          onUnavailable: () => console.warn('Local word timing unavailable.'),
        } : undefined, commercialPreview, { onCleanupFailure: () => console.warn('Gemini file cleanup could not be confirmed.') }),
      label: 'Subtítulos de video', accepts: '.mp4,video/mp4',
      filename: 'subtitulos.srt', contentType: 'application/x-subrip; charset=utf-8',
      directions, editableVideo: true,
    });
  }
  const payments = testKey && testSecret && testMerchant
    ? createPayPalSandbox(testKey, testSecret, testMerchant) : createSimulatedPayments();
  const pool = new Pool({ connectionString, options: '-c search_path=' + schema, connectionTimeoutMillis: 5000 });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [schema]);
      const exists = await client.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema]);
      if (!exists.rowCount) {
        await client.query('CREATE SCHEMA ' + schema);
        await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
      } else {
        const retention = await client.query(
          "SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='inputs' AND column_name='expires_at'",
          [schema],
        );
        if (!retention.rowCount) {
          await client.query(await readFile(new URL('./pilotRetentionMigration.sql', import.meta.url), 'utf8'));
        }
        await client.query(await readFile(new URL('./pilotProjectMigration.sql', import.meta.url), 'utf8'));
        await client.query(await readFile(new URL('./pilotTracksMigration.sql', import.meta.url), 'utf8'));
        await client.query(await readFile(new URL('./pilotStylesMigration.sql', import.meta.url), 'utf8'));
        await client.query(await readFile(new URL('./pilotHighlightsMigration.sql', import.meta.url), 'utf8'));
      }
      await client.query(await readFile(new URL('./privateInputMigration.sql', import.meta.url), 'utf8'));
      await client.query(await readFile(new URL('./privateUploads.sql', import.meta.url), 'utf8'));
      if (previewLaunchLanguages || commercialPreview) {
        await client.query(await readFile(new URL('./pilotLanguageRequestsMigration.sql', import.meta.url), 'utf8'));
      }
      if (previewConversionAttribution || commercialPreview) {
        await client.query(await readFile(new URL('./pilotAttributionMigration.sql', import.meta.url), 'utf8'));
      }
      if (commercialPreview) {
        await client.query(await readFile(new URL('./accountAccess.sql', import.meta.url), 'utf8'));
      } else {
        await client.query('INSERT INTO accounts(id) VALUES ($1) ON CONFLICT DO NOTHING', [accountId]);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    const editorDir = new URL('../../dist/pilot-editor/', import.meta.url);
    const editorAssets = await access(new URL('editor.js', editorDir)).then(() => editorDir, error => {
      if (useGemini || error.code !== 'ENOENT') throw error;
      return undefined;
    });
    const pilot = await startPilot({
      pool, invitations: commercialPreview ? new Map() : new Map([[invitation!, accountId!]]), services, payments,
      paypalWebClientId: usePayPalWebSdk && !payments.simulateApproval ? testKey : undefined,
      port: 3001, editorAssets, previewLaunchLanguages, previewConversionAttribution,
      uploads: privateStorage ? new ResumableUploads(pool, new PrivateFileStore(privateStorage)) : undefined,
      commercialPreview: firebase ? { firebase } : supabase ? { supabase } : commercialPreview && outbox ? {
        sendAccessCode: message => writeFile(join(outbox, randomUUID() + '.json'), JSON.stringify(message),
          { flag: 'wx', mode: 0o600 }),
      } : undefined,
      privateOrigin: process.env.LINGUISTVISION_PILOT_PRIVATE_ORIGIN,
      proxyHost: process.env.LINGUISTVISION_PILOT_PROXY_HOST,
      onWorkerError: () => console.warn('A pilot task will retry.'),
    });
    console.log((commercialPreview ? 'LinguistVision commercial preview: ' : 'Private LinguistVision pilot: ') +
      pilot.origin + (commercialPreview ? '/' : '/pilot/'));
    let closing = false;
    const close = async () => {
      if (closing) return;
      closing = true;
      try { await pilot.close(); } finally { await pool.end(); }
    };
    process.once('SIGINT', () => { void close(); });
    process.once('SIGTERM', () => { void close(); });
  } catch (error) {
    await pool.end();
    throw error;
  }
}

void main().catch(() => {
  console.error('The local pilot could not start. Check its environment, database and port 3001.');
  process.exitCode = 1;
});
