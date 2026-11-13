/**
 * Lightweight stale-while-revalidate snapshot cache (memory + localStorage).
 * Only stores public, non-sensitive schedule/directory/statistics payloads.
 */

interface CacheEnvelope<T> {
  ts: number;
  data: T;
}

const MEMORY_CACHE = new Map<string, CacheEnvelope<unknown>>();
const PREFIX = "cs:swr:v1:";

/**
 * Computes the current academic year start (matches /educational-process convention).
 */
export function getCurrentAcademicYear(now: Date = new Date()): number {
  return now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
}

/**
 * Reads a cached snapshot if it exists and is younger than maxAgeMs.
 */
export function readCacheSnapshot<T>(
  key: string,
  maxAgeMs: number = 30 * 60 * 1000,
): { data: T; fresh: boolean } | null {
  const fullKey = `${PREFIX}${key}`;
  const now = Date.now();

  const memHit = MEMORY_CACHE.get(fullKey) as CacheEnvelope<T> | undefined;
  if (memHit && typeof memHit.ts === "number") {
    const age = now - memHit.ts;
    if (age <= maxAgeMs) {
      return { data: memHit.data, fresh: age <= 60 * 1000 };
    }
  }

  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(fullKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T> | null;
    if (!parsed || typeof parsed.ts !== "number" || !("data" in parsed)) {
      return null;
    }
    const age = now - parsed.ts;
    if (age > maxAgeMs) return null;
    MEMORY_CACHE.set(fullKey, parsed);
    return { data: parsed.data, fresh: age <= 60 * 1000 };
  } catch {
    return null;
  }
}

/**
 * Persists a snapshot in memory and best-effort localStorage without throwing on quota errors.
 */
export function writeCacheSnapshot<T>(key: string, data: T): void {
  const fullKey = `${PREFIX}${key}`;
  const envelope: CacheEnvelope<T> = { ts: Date.now(), data };
  MEMORY_CACHE.set(fullKey, envelope);

  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(fullKey, JSON.stringify(envelope));
  } catch {
    // Ignore storage quota / private mode failures; memory cache still works.
  }
}
