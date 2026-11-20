/**
 * Active and passive spaces: a space is active while an edge has read or
 * written its graph in the last 14 days. The cloud notes the touch
 * (edgeGraphs, at most once an hour; graph-shared/activity.ts); this only
 * reads it. Pure, so it is tested here and used by the site.
 */

export const ACTIVE_DAYS = 14;
const DAY = 86_400_000;

export interface Activity {
  name: string;
  edgeSeenAt?: string | null;
  edgeSeenName?: string | null;
  updatedAt?: string | null;
}

export function isActive(a: Pick<Activity, "edgeSeenAt"> | undefined, now: number = Date.now()): boolean {
  const t = a?.edgeSeenAt ? Date.parse(a.edgeSeenAt) : NaN;
  return Number.isFinite(t) && now - t < ACTIVE_DAYS * DAY;
}

/** Items into active (latest edge use first) and passive (latest change first). */
export function split<S extends { id: string }>(items: S[], activity: Record<string, Activity>, now: number = Date.now()): { active: S[]; passive: S[] } {
  const seen = (s: S) => Date.parse(activity[s.id]?.edgeSeenAt ?? "") || 0;
  const changed = (s: S) => Date.parse(activity[s.id]?.updatedAt ?? "") || 0;
  const active = items.filter((s) => isActive(activity[s.id], now)).sort((a, b) => seen(b) - seen(a));
  const passive = items.filter((s) => !isActive(activity[s.id], now)).sort((a, b) => changed(b) - changed(a));
  return { active, passive };
}

/** "3 h", "2 d": how long ago, as a key and a number for t(). */
export function ago(iso: string | null | undefined, now: number = Date.now()): { key: string; n: number } | null {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return null;
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return { key: "ago.now", n: 0 };
  if (min < 60) return { key: "ago.min", n: min };
  if (min < 48 * 60) return { key: "ago.h", n: Math.round(min / 60) };
  return { key: "ago.d", n: Math.round(min / 1440) };
}
