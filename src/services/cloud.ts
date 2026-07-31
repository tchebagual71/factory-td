import { loadLocal, saveLocal } from '../state/persistence';
import {
  LifetimeProgress,
  mergeAchievements,
  mergeBest,
  mergeLifetimeProgress,
  newerRun,
  validateLifetimeProgress,
} from '../state/mergeProgress';
import { meta } from '../state/meta';
import { progress } from '../state/progress';
import { LatestSaveQueue } from '../state/saveQueue';
import { SaveV1, validateSave } from '../state/serialize';
import { currentUser, ensureProfile, isAnonymous } from './auth';
import { getClient } from './supabase';

/**
 * Cloud sync facade. localStorage stays the primary store; everything here is
 * best-effort mirroring for signed-in players. All calls are safe to
 * fire-and-forget — failures log and never touch gameplay. Merge decisions
 * live (pure, tested) in state/mergeProgress.ts.
 */

export interface LeaderboardRow {
  display_name: string;
  best_wave: number;
  updated_at: string;
  user_id: string;
}

/**
 * Authentication lookup is part of the queued write so two pushSave calls can
 * never reach the saves row concurrently. A missing client or session remains
 * a successful no-op, exactly like every other best-effort cloud path.
 */
async function writeSave(save: SaveV1): Promise<void> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return;
  const { error } = await c.from('saves').upsert({ user_id: u.id, data: save, wave: save.wave });
  if (error) console.warn('[cloud] pushSave:', error.message);
}

const saveQueue = new LatestSaveQueue<SaveV1>(writeSave);

/** Queue the newest cloud mirror without making gameplay wait for the network. */
export function pushSave(save: SaveV1): void {
  saveQueue.request(save);
}

export async function pullSave(): Promise<{ save: SaveV1; updatedAt: number } | null> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return null;
  const { data, error } = await c.from('saves').select('data, updated_at').eq('user_id', u.id).maybeSingle();
  if (error || !data) return null;
  const save = validateSave(data.data); // never trust cloud JSON
  return save ? { save, updatedAt: Date.parse(data.updated_at) } : null;
}

export async function clearSave(): Promise<void> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return;
  await c.from('saves').delete().eq('user_id', u.id);
}

/** Leaderboard is permanent accounts only — anonymous pushes are skipped (RLS blocks them anyway). */
export async function pushBest(wave: number): Promise<void> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u || isAnonymous(u) || wave < 1) return;
  const { error } = await c.from('scores').upsert({ user_id: u.id, best_wave: wave });
  if (error) console.warn('[cloud] pushBest:', error.message);
}

export async function fetchLeaderboard(limit = 20): Promise<LeaderboardRow[]> {
  const c = getClient();
  if (!c) return [];
  const { data, error } = await c.from('leaderboard').select('*').limit(limit);
  if (error) {
    console.warn('[cloud] leaderboard:', error.message);
    return [];
  }
  return (data ?? []) as LeaderboardRow[];
}

export async function pushAchievements(ids: string[]): Promise<void> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u || ids.length === 0) return;
  const rows = ids.map((achievement_id) => ({ user_id: u.id, achievement_id }));
  const { error } = await c.from('achievements').upsert(rows, { ignoreDuplicates: true });
  if (error) console.warn('[cloud] pushAchievements:', error.message);
}

async function pullAchievements(): Promise<Set<string>> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return new Set();
  const { data } = await c.from('achievements').select('achievement_id').eq('user_id', u.id);
  return new Set((data ?? []).map((r) => r.achievement_id as string));
}

async function pullBest(): Promise<number> {
  const c = getClient();
  const u = await currentUser();
  if (!c || !u) return 0;
  const { data } = await c.from('scores').select('best_wave').eq('user_id', u.id).maybeSingle();
  return data?.best_wave ?? 0;
}

interface ProfileProgressPull {
  /** False means the request failed, including a deployment without the column. */
  available: boolean;
  progress: LifetimeProgress | null;
}

/**
 * The profile column ships separately from this client. Treat a missing column,
 * paused project, or blocked request as no cloud at all; none may turn into an
 * empty snapshot that erases local progress.
 */
async function pullLifetimeProgress(): Promise<ProfileProgressPull> {
  try {
    const c = getClient();
    const u = await currentUser();
    if (!c || !u) return { available: false, progress: null };
    const { data, error } = await c.from('profiles').select('progress').eq('id', u.id).maybeSingle();
    if (error || !data) return { available: false, progress: null };
    return { available: true, progress: validateLifetimeProgress(data.progress) };
  } catch {
    return { available: false, progress: null };
  }
}

/** Best-effort mirror; deliberately silent while the schema rolls out. */
async function pushLifetimeProgress(snapshot: LifetimeProgress): Promise<void> {
  try {
    const c = getClient();
    const u = await currentUser();
    if (!c || !u) return;
    await c.from('profiles').update({ progress: snapshot }).eq('id', u.id);
  } catch {
    // Local state already contains the merge. Cloud absence is the guest path.
  }
}

/**
 * Full two-way merge, run once per sign-in (and after identity linking):
 * newest run save wins both directions; Workshop nodes, wallet, and lifetime
 * stats max-merge; achievements union; leaderboard best wave max.
 */
export async function syncOnSignIn(): Promise<void> {
  const u = await currentUser();
  if (!u) return;
  await ensureProfile();

  const local = loadLocal();
  const cloud = await pullSave();
  const choice = newerRun(local?.savedAt ?? null, cloud ? cloud.save.savedAt : null);
  if (choice === 'cloud' && cloud) saveLocal(cloud.save);
  else if (choice === 'local' && local) await pushSave(local);

  const cloudProgress = await pullLifetimeProgress();
  if (cloudProgress.available && cloudProgress.progress) {
    const merged = mergeLifetimeProgress(
      { v: 1, workshop: meta.snapshot(), stats: progress.stats },
      cloudProgress.progress,
    );
    meta.absorb(merged.workshop);
    progress.absorbStats(merged.stats);
  }

  const best = mergeBest(progress.stats.bestWave, await pullBest());
  progress.recordMax('bestWave', best);
  await pushBest(best);

  // Push after best-wave reconciliation so the jsonb mirror cannot lag the
  // existing scores row on the very sign-in that introduced it.
  if (cloudProgress.available) {
    await pushLifetimeProgress({ v: 1, workshop: meta.snapshot(), stats: { ...progress.stats } });
  }

  const cloudAch = await pullAchievements();
  const merge = mergeAchievements(progress.unlocked, cloudAch);
  progress.absorb(merge.toAbsorb);
  await pushAchievements(merge.toPush);
}
