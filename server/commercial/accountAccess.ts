import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';

export type SendAccessCode = (message: { email: string; code: string; locale: string }) => Promise<void>;
export const commercialSessionSeconds = 8 * 60 * 60;
const fingerprint = (token: string) => createHash('sha256').update(token).digest('hex');

export function normalizeEmail(value: unknown) {
  if (typeof value !== 'string') return;
  const email = value.trim().toLowerCase();
  if (email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return email;
}

export function createAccountAccess(pool: Pool, send: SendAccessCode) {
  const key = randomBytes(32);
  const hashCode = (email: string, code: string) => createHmac('sha256', key).update(email + '\0' + code).digest();
  return {
    async firebaseAccount(uid: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['firebase:' + uid]);
        const { rows: [identity] } = await client.query<{ account_id: string }>(
          'SELECT account_id FROM commercial_firebase_identities WHERE firebase_uid=$1', [uid]);
        const account = identity?.account_id ?? randomUUID();
        if (!identity) {
          await client.query('INSERT INTO accounts(id) VALUES ($1)', [account]);
          await client.query('INSERT INTO commercial_firebase_identities(firebase_uid,account_id) VALUES ($1,$2)', [uid, account]);
        }
        await client.query('COMMIT');
        return account;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async verifiedProviderSession(userId: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['supabase:' + userId]);
        const { rows: [identity] } = await client.query<{ account_id: string }>(
          'SELECT account_id FROM commercial_supabase_identities WHERE user_id=$1', [userId]);
        const account = identity?.account_id ?? randomUUID();
        if (!identity) {
          await client.query('INSERT INTO accounts(id) VALUES ($1)', [account]);
          await client.query('INSERT INTO commercial_supabase_identities(user_id,account_id) VALUES ($1,$2)', [userId, account]);
        }
        const token = randomBytes(32).toString('base64url');
        await client.query(
          "INSERT INTO commercial_sessions(digest,account_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '8 hours')",
          [fingerprint(token), account]);
        await client.query('COMMIT');
        return token;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async revokeProviderSessions(userId: string) {
      await pool.query(`DELETE FROM commercial_sessions WHERE account_id IN
        (SELECT account_id FROM commercial_supabase_identities WHERE user_id=$1)`, [userId]);
    },
    async allowPasswordReset(token: string, userId: string) {
      await pool.query(`INSERT INTO commercial_password_resets(digest,user_id,expires_at)
        VALUES ($1,$2,clock_timestamp()+interval '5 minutes') ON CONFLICT DO NOTHING`, [fingerprint(token), userId]);
    },
    async takePasswordReset(token: string) {
      const { rows: [reset] } = await pool.query<{ user_id: string }>(`DELETE FROM commercial_password_resets
        WHERE digest=$1 AND expires_at>clock_timestamp() RETURNING user_id`, [fingerprint(token)]);
      return reset?.user_id;
    },
    async request(email: string, locale: string, register: boolean) {
      if (!register && !(await pool.query('SELECT 1 FROM commercial_identities WHERE email=$1', [email])).rowCount) return;
      const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
      const digest = hashCode(email, code).toString('hex');
      const result = await pool.query(
        `INSERT INTO commercial_email_codes(email,digest,expires_at)
         VALUES ($1,$2,clock_timestamp()+interval '10 minutes')
         ON CONFLICT(email) DO UPDATE SET digest=EXCLUDED.digest, expires_at=EXCLUDED.expires_at,
           created_at=EXCLUDED.created_at, attempts=0
         WHERE commercial_email_codes.created_at < clock_timestamp()-interval '60 seconds'`,
        [email, digest],
      );
      if (!result.rowCount) return;
      try { await send({ email, code, locale }); }
      catch (error) {
        await pool.query('DELETE FROM commercial_email_codes WHERE email=$1 AND digest=$2', [email, digest]);
        throw error;
      }
    },
    async verify(email: string, code: string) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [challenge] } = await client.query<{ digest: string }>(
          `UPDATE commercial_email_codes SET attempts=attempts+1
           WHERE email=$1 AND expires_at>clock_timestamp() AND attempts<5 RETURNING digest`, [email],
        );
        if (!challenge || !timingSafeEqual(hashCode(email, code), Buffer.from(challenge.digest, 'hex'))) {
          await client.query('COMMIT');
          return;
        }
        await client.query('DELETE FROM commercial_email_codes WHERE email=$1', [email]);
        const identity = await client.query<{ account_id: string }>(
          'SELECT account_id FROM commercial_identities WHERE email=$1', [email],
        );
        let account = identity.rows[0]?.account_id;
        if (!account) {
          account = randomUUID();
          await client.query('INSERT INTO accounts(id) VALUES ($1)', [account]);
          await client.query('INSERT INTO commercial_identities(email,account_id) VALUES ($1,$2)', [email, account]);
        }
        const token = randomBytes(32).toString('base64url');
        await client.query(
          "INSERT INTO commercial_sessions(digest,account_id,expires_at) VALUES ($1,$2,clock_timestamp()+interval '8 hours')",
          [fingerprint(token), account],
        );
        await client.query('COMMIT');
        return token;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async account(token: string) {
      const { rows: [session] } = await pool.query<{ account_id: string }>(
        'SELECT account_id FROM commercial_sessions WHERE digest=$1 AND expires_at>clock_timestamp()', [fingerprint(token)],
      );
      return session?.account_id;
    },
    async revoke(token: string) {
      await pool.query('DELETE FROM commercial_sessions WHERE digest=$1', [fingerprint(token)]);
    },
    async purgeExpired() {
      await pool.query('DELETE FROM commercial_email_codes WHERE expires_at<=clock_timestamp()');
      await pool.query('DELETE FROM commercial_sessions WHERE expires_at<=clock_timestamp()');
      await pool.query('DELETE FROM commercial_password_resets WHERE expires_at<=clock_timestamp()');
    },
  };
}
