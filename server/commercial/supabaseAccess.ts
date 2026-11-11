import { createClient } from '@supabase/supabase-js';

export type SupabaseAccessConfig = { url: string; publishableKey: string; fetch?: typeof fetch };

export function createSupabaseAccess({ url, publishableKey, fetch: send = fetch }: SupabaseAccessConfig) {
  const project = new URL(url);
  if (project.username || project.password || project.pathname !== '/' || project.search || project.hash ||
      !(project.protocol === 'https:' || (project.protocol === 'http:' && project.hostname === '127.0.0.1'))) {
    throw new Error('Use the HTTPS URL of the LinguistVision Supabase project.');
  }

  const safeFetch: typeof fetch = (input, init) => send(input, { ...init, redirect: 'error', signal: AbortSignal.timeout(15_000) });

  return {
    origin: project.origin,
    client(verifier?: Record<string, string>, onVerifier?: (values: Record<string, string>) => void) {
      const storage = new Map(Object.entries(verifier ?? {}));
      const key = 'linguistvision-auth';
      return createClient(project.origin, publishableKey, {
        global: { fetch: safeFetch },
        auth: {
          flowType: 'pkce', storageKey: key, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false,
          storage: {
            getItem: name => storage.get(name) ?? null,
            setItem(name, value) {
              storage.set(name, value);
              if (name.endsWith('-code-verifier')) {
                onVerifier?.(Object.fromEntries([...storage].filter(([item]) => item.endsWith('-code-verifier'))));
              }
            },
            removeItem(name) { storage.delete(name); },
          },
        },
      });
    },
    async updatePassword(token: string, password: string) {
      const response = await safeFetch(project.origin + '/auth/v1/user', {
        method: 'PUT', headers: { apikey: publishableKey, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      return response.ok;
    },
  };
}
