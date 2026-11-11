import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

export interface FirebaseIdentity {
  verifyIdToken(token: string, checkRevoked: true): Promise<DecodedIdToken>;
  createSessionCookie(token: string, options: { expiresIn: number }): Promise<string>;
  verifySessionCookie(token: string, checkRevoked: true): Promise<DecodedIdToken>;
}

export interface FirebaseAccessConfig {
  web: FirebaseWebConfig;
  identity?: FirebaseIdentity;
  emulator?: string;
}

export function firebaseIdentity(config: FirebaseAccessConfig): { identity: FirebaseIdentity; app?: App } {
  const { web, emulator } = config;
  if (![web.apiKey, web.appId].every(value => typeof value === 'string' && value.length > 0) ||
      !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(web.projectId) ||
      !/^[a-z0-9.-]+$/.test(web.authDomain)) throw new Error('Invalid LinguistVision Firebase web configuration.');
  if (emulator && (!/^127\.0\.0\.1:\d{2,5}$/.test(emulator) || process.env.FIREBASE_AUTH_EMULATOR_HOST !== emulator)) {
    throw new Error('Use an explicitly configured loopback Auth emulator.');
  }
  if (!emulator && process.env.FIREBASE_AUTH_EMULATOR_HOST) throw new Error('Disable the Auth emulator for hosted Firebase.');
  if (config.identity) return { identity: config.identity };
  const app = initializeApp({ projectId: web.projectId, ...(emulator ? {} : { credential: applicationDefault() }),
    httpAgent: undefined }, 'linguistvision-' + randomUUID());
  return { identity: getAuth(app), app };
}

export function verifiedFirebaseUser(user: DecodedIdToken) {
  return typeof user.uid === 'string' && user.uid.length > 0 && user.uid.length <= 128 && user.email_verified === true;
}
