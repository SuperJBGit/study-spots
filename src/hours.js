// Library hours from U of T Libraries' LibCal feed, cached in the browser once a day.
import { isoDate } from "./logic.js";

export const FEED_URL = "https://libcal.library.utoronto.ca/api_hours_grid.php?iid=478&format=json&weeks=3";
const CACHE_KEY = "libcal-hours-v1";

// Turn the feed's { locations: [{ lid, weeks: [{ Sunday: { date, times } }] }] } into { [lid]: { [date]: times } }.
export function indexFeed(json) {
  const byLid = {};
  for (const loc of json.locations || []) {
    const days = (byLid[loc.lid] = {});
    for (const week of loc.weeks || []) {
      for (const d of Object.values(week)) if (d && d.date) days[d.date] = d.times || {};
    }
  }
  return byLid;
}

function readCache(storage) {
  try {
    return JSON.parse(storage.getItem(CACHE_KEY) || "null");
  } catch {
    return null;
  }
}

// Returns { libcal, fetchedAt: Date | null, stale: bool, error: string | null }
export async function loadLibraryHours({ fetchImpl = fetch, storage = globalThis.localStorage, now = new Date() } = {}) {
  const cached = storage ? readCache(storage) : null;
  if (cached && cached.day === isoDate(now)) {
    return { libcal: cached.libcal, fetchedAt: new Date(cached.fetchedAt), stale: false, error: null };
  }
  try {
    const res = await fetchImpl(FEED_URL);
    if (!res.ok) throw new Error(`feed answered ${res.status}`);
    const libcal = indexFeed(await res.json());
    try {
      storage?.setItem(CACHE_KEY, JSON.stringify({ day: isoDate(now), fetchedAt: now.toISOString(), libcal }));
    } catch {
      /* storage full or blocked: fine, we just refetch next time */
    }
    return { libcal, fetchedAt: now, stale: false, error: null };
  } catch (e) {
    if (cached) return { libcal: cached.libcal, fetchedAt: new Date(cached.fetchedAt), stale: true, error: String(e.message || e) };
    return { libcal: {}, fetchedAt: null, stale: true, error: String(e.message || e) };
  }
}
