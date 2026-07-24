import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js';
import { getClient } from './supabase';

/**
 * Auth facade. Sign-in is only ever initiated from the menu (OAuth navigates
 * away from the page). Every function resolves to an error message or null —
 * callers surface it in UI, nothing throws into gameplay.
 */

/** Works on both GitHub Pages (/factory-td/) and localhost. */
function redirectTarget(): string {
  return window.location.origin + window.location.pathname;
}

export async function signInGoogle(): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Cloud unavailable';
  const { error } = await c.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTarget() },
  });
  return error?.message ?? null;
}

export async function signInMagicLink(email: string): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Cloud unavailable';
  const { error } = await c.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTarget() },
  });
  return error?.message ?? null;
}

/** Device-bound cloud backup without email — upgradeable later via linking. */
export async function signInAnon(): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Cloud unavailable';
  const { error } = await c.auth.signInAnonymously();
  return error?.message ?? null;
}

/** Link a Google identity to the current (anonymous) user — same uid, all rows carry over. */
export async function linkGoogle(): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Cloud unavailable';
  const { error } = await c.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: redirectTarget() },
  });
  return error?.message ?? null;
}

/** Attach an email to the current (anonymous) user; a confirmation email verifies it. */
export async function linkEmail(email: string): Promise<string | null> {
  const c = getClient();
  if (!c) return 'Cloud unavailable';
  const { error } = await c.auth.updateUser({ email });
  return error?.message ?? null;
}

export async function signOut(): Promise<void> {
  await getClient()?.auth.signOut().catch(() => undefined);
}

export async function currentUser(): Promise<User | null> {
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session?.user ?? null;
}

export function isAnonymous(u: User | null): boolean {
  return u?.is_anonymous === true;
}

/** Short label for the account chip. */
export function accountLabel(u: User | null): string {
  if (!u) return 'GUEST';
  if (isAnonymous(u)) return 'CLOUD GUEST';
  return u.email ?? (u.user_metadata?.name as string | undefined) ?? 'SIGNED IN';
}

/** Subscribe to auth changes; returns an unsubscribe function. */
export function onAuth(cb: (event: AuthChangeEvent, session: Session | null) => void): () => void {
  const c = getClient();
  if (!c) return () => undefined;
  const { data } = c.auth.onAuthStateChange(cb);
  return () => data.subscription.unsubscribe();
}

/** Create the profiles row on first sign-in without clobbering an existing name. */
export async function ensureProfile(preferredName?: string): Promise<void> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return;
  const { data } = await c.from('profiles').select('id').eq('id', u.id).maybeSingle();
  if (data) return;
  const meta = (u.user_metadata?.name ?? u.user_metadata?.full_name) as string | undefined;
  const name = (preferredName ?? meta ?? 'Player').trim().slice(0, 20) || 'Player';
  await c.from('profiles').insert({ id: u.id, display_name: name });
}

export async function setDisplayName(name: string): Promise<string | null> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return 'Not signed in';
  const trimmed = name.trim().slice(0, 20);
  if (!trimmed) return 'Name cannot be empty';
  const { error } = await c.from('profiles').upsert({ id: u.id, display_name: trimmed });
  return error?.message ?? null;
}
