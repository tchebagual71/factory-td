import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Lazy Supabase client singleton. The publishable key is safe to embed in a
 * public client — row access is governed entirely by RLS. If client creation
 * fails (blocked network, paused project), every service degrades to a no-op
 * and the game runs exactly as it does for guests.
 */

const SUPABASE_URL = 'https://ksxkenxpidatyqraaffn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_TvJy3OOWYpfY7cfryFUkCw_aU9JFb_6';

let client: SupabaseClient | null | undefined;

export function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  try {
    client = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true, // handles the ?code= exchange after OAuth/magic-link redirects
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  } catch (e) {
    console.warn('[cloud] supabase unavailable:', e);
    client = null;
  }
  return client;
}
