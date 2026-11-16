import {applicationDefault, initializeApp, deleteApp} from 'firebase-admin/app';
import {initializeFirestore} from 'firebase-admin/firestore';
import {getAuth} from 'firebase-admin/auth';
import {randomUUID} from 'node:crypto';
import {FirestoreBackend} from './firestoreBackend';

/** Hosted factory: project is explicit; inherited emulators are rejected. */
export function firestoreRuntime(projectId: 'vistavo-prod' | 'linguistvision-dev') {
  if (!['vistavo-prod', 'linguistvision-dev'].includes(projectId) ||
      process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Hosted runtime requires managed identity and no emulators/credential files');
  const credential = applicationDefault();
  const app = initializeApp({projectId, credential}, 'vistavo-cloud-' + randomUUID());
  // Public Admin SDK transport option; no listeners/onSnapshot on this server client.
  const db = initializeFirestore(app,{preferRest:true});
  const root=db.collection('vistavo').doc('candidate-v1');
  return {db,root,backend: new FirestoreBackend(db,root),
    identity: getAuth(app), accessToken: async () => (await credential.getAccessToken()).access_token,
    close: async () => {await db.terminate(); await deleteApp(app);}};
}
