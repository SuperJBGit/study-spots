// Pure functions: who can use a spot, whether it’s open, walking time, busyness, ranking.
// No DOM and no network, so the app and the tests share them.

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MIN_PER_DAY = 1440;

// ---------- access ----------

// profile: { fac: "as" | "eng" | "md" | "other" | "visitor", prog, col, res: "none" | college key | "other", csc: bool }
export function allows(rule, p) {
  if (rule === "all") return true;
  if (p.fac === "visitor") return false;
  if (rule === "uoft") return true;
  if (rule === "?") return true; // unclear: shown, but flagged and ranked lower
  if (rule === "csc") return !!p.csc;
  if (rule === "md") return p.fac === "md";
  const [kind, val] = rule.split(":");
  if (kind === "prog") return p.fac === "eng" && p.prog === val;
  if (kind === "col") return p.fac === "as" && p.col === val;
  if (kind === "res") return p.res === val;
  if (kind === "comm") return p.fac === "as" && p.col === val && p.res === "none";
  return false;
}

// { ok, mine, unclear }: mine = only open to a group this student belongs to.
export function access(spot, p) {
  const ok = spot.who.some((r) => allows(r, p));
  const unclear = spot.who[0] === "?";
  const open = spot.who.some((r) => r === "all" || r === "uoft");
  const mine = ok && !open && !unclear;
  return { ok, mine, unclear };
}

// ---------- time ----------

export function isoDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
const minutesOfDay = (d) => d.getHours() * 60 + d.getMinutes();

// "8:30am" -> 510, "12am" -> 0, "12pm" -> 720, "11:59pm" -> 1439
export function parseClock(s) {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(String(s).trim());
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "pm") h += 12;
  return h * 60 + Number(m[2] || 0);
}
// "07:00" -> 420, "24:00" -> 1440
export const parseHHMM = (s) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

export function isClosureDay(dateISO, calendar) {
  return calendar.universityClosed.some((c) => dateISO >= c.from && dateISO <= c.to);
}

// Hours for one spot on one date.
// Returns { state: "open" | "closed" | "unknown" | "appointment", intervals: [[start, end]], note }
// Minutes are from that date's midnight; an end past 1440 runs into the next day.
// ctx: { libcal: { [lid]: { [dateISO]: times } }, calendar }
export function dayHours(spot, dateISO, ctx) {
  // Temporarily closed (construction and the like): `closed: { reason, reported, text }` in spots.json.
  if (spot.closed) return { state: "closed", intervals: [], note: spot.closed.reason };
  const closure = isClosureDay(dateISO, ctx.calendar);
  if (spot.hours.type === "libcal") {
    const lid = spot.hours.lid;
    if (closure && ctx.calendar.noHolidayLids.includes(lid)) {
      return { state: "closed", intervals: [], note: "University closed" };
    }
    const t = ctx.libcal?.[lid]?.[dateISO];
    if (!t) return { state: "unknown", intervals: [], note: "No hours in the feed for this date" };
    if (t.status === "closed") return { state: "closed", intervals: [], note: t.note };
    if (t.status === "24hours") return { state: "open", intervals: [[0, MIN_PER_DAY]] };
    if (t.status === "open" && Array.isArray(t.hours)) {
      const intervals = t.hours
        .map((h) => {
          const a = parseClock(h.from);
          let b = parseClock(h.to);
          if (a == null || b == null) return null;
          if (b === 1439) b = MIN_PER_DAY; // "11:59pm" means until midnight
          if (b <= a) b += MIN_PER_DAY; // runs past midnight
          return [a, b];
        })
        .filter(Boolean);
      return intervals.length ? { state: "open", intervals } : { state: "unknown", intervals: [] };
    }
    if (t.status === "ByApp") return { state: "appointment", intervals: [] };
    return { state: "unknown", intervals: [], note: t.text };
  }
  if (spot.hours.type === "weekly") {
    // Cafés and other off-campus places keep their own calendar: `"ignoresUniversityClosures": true`.
    if (closure && !spot.hours.ignoresUniversityClosures) return { state: "closed", intervals: [], note: "University closed" };
    const day = DAY_KEYS[new Date(dateISO + "T12:00:00").getDay()];
    const list = spot.hours.week[day] || [];
    if (!list.length) return { state: "closed", intervals: [] };
    return { state: "open", intervals: list.map(([a, b]) => [parseHHMM(a), parseHHMM(b)]) };
  }
  return { state: "unknown", intervals: [] };
}

// Is the spot open at `now`, and until when?
// Returns { open: true|false|null, until: Date|null, opensAt: Date|null }
// open is null when hours are unknown.
export function openStatus(spot, now, ctx) {
  const today = isoDate(now);
  const t = minutesOfDay(now);
  // Collect intervals from yesterday (spill past midnight), today and the next 6 days, as absolute minutes from today's midnight.
  // A week ahead covers Robarts Common, which stays open from Sunday morning to Friday night.
  const spans = [];
  let unknownToday = false;
  for (let k = -1; k <= 6; k++) {
    const d = isoDate(addDays(now, k));
    const h = dayHours(spot, d, ctx);
    if (k === 0 && (h.state === "unknown" || h.state === "appointment")) unknownToday = true;
    for (const [a, b] of h.intervals) spans.push([a + k * MIN_PER_DAY, b + k * MIN_PER_DAY]);
  }
  // Merge touching spans so Robarts Common's 24 h days chain together.
  spans.sort((x, y) => x[0] - y[0]);
  const merged = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const midnight = new Date(today + "T00:00:00");
  const at = (m) => new Date(midnight.getTime() + m * 60000);
  const cur = merged.find(([a, b]) => a <= t && t < b);
  // Open through the whole week we look at: treat it as always open rather than inventing a closing time.
  if (cur && cur[1] >= 7 * MIN_PER_DAY) return { open: true, until: null, always: true, opensAt: null };
  if (cur) return { open: true, until: at(cur[1]), opensAt: null };
  if (unknownToday) return { open: null, until: null, opensAt: null };
  const next = merged.find(([a]) => a > t);
  return { open: false, until: null, opensAt: next ? at(next[0]) : null };
}

// ---------- distance ----------

// Straight-line metres between two {lat, lon} points.
export function metresBetween(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Walking minutes: straight line × 1.3 for real paths, at 80 m per minute.
export function walkMinutes(a, b) {
  if (!a || !b) return null;
  return Math.max(1, Math.ceil((metresBetween(a, b) * 1.3) / 80));
}

// Buildings you're probably in or at, nearest first: within `radius` metres of the building's point.
// A fix less accurate than `maxAccuracy` metres can't tell neighbouring buildings apart, so it returns none.
export function buildingsHere(point, accuracy, buildings, radius = 80, maxAccuracy = 100) {
  if (!point || accuracy == null || accuracy > maxAccuracy) return [];
  return Object.entries(buildings)
    .map(([key, b]) => ({ key, metres: metresBetween(point, b) }))
    .filter((x) => x.metres <= radius)
    .sort((a, b) => a.metres - b.metres);
}

// ---------- busyness (crowd reports) ----------
// The backend returns { live: { spotId: { level, at, n } }, typical: { spotId: { "wd14": { avg, n, days } } } }.
// Levels: 1 plenty of seats, 2 filling up, 3 full. Hour buckets are weekday/weekend × hour, in local (Toronto) time.

export const BUSY_LEVELS = { 1: "Plenty of seats", 2: "Filling up", 3: "Full" };
export const LIVE_MINUTES = 45;

export const hourBucket = (d) => (d.getDay() === 0 || d.getDay() === 6 ? "we" : "wd") + d.getHours();

// A usual pattern needs at least 3 reports for that hour, from at least 2 different days.
const enough = (t) => t && t.n >= 3 && (t.days ?? 0) >= 2;
const typicalLevel = (avg) => (avg >= 2.5 ? 3 : avg >= 1.8 ? 2 : 1);

// How busy a spot is right now: a fresh report wins, then the usual pattern for this hour, else null.
// Never says "quiet" just because nobody reported.
export function busyStatus(spotId, busy, now) {
  const live = busy?.live?.[spotId];
  if (live) {
    const age = (now - new Date(live.at)) / 60000;
    if (age >= -5 && age <= LIVE_MINUTES) return { kind: "live", level: live.level, ageMin: Math.max(0, Math.round(age)), n: live.n || 1 };
  }
  const t = busy?.typical?.[spotId]?.[hourBucket(now)];
  if (enough(t)) return { kind: "typical", level: typicalLevel(t.avg), avg: t.avg, n: t.n };
  return null;
}

export function busyLabel(b) {
  if (!b) return "";
  if (b.kind === "live") return `${BUSY_LEVELS[b.level]} · ${b.ageMin < 2 ? "just now" : `${b.ageMin} min ago`}`;
  return ["", "Usually quiet around now", "Usually busy around now", "Usually full around now"][b.level];
}

// The usual pattern through today (weekday or weekend), hour by hour: [{ hour, level|null, n }].
export function typicalDay(spotId, busy, now, from = 8, to = 23) {
  const prefix = hourBucket(now).slice(0, 2);
  const out = [];
  for (let h = from; h <= to; h++) {
    const t = busy?.typical?.[spotId]?.[prefix + h];
    out.push({ hour: h, level: enough(t) ? typicalLevel(t.avg) : null, avg: t?.avg ?? null, n: t?.n ?? 0 });
  }
  return out;
}

// ---------- ranking ----------

const LOUD = new Set(["Social", "Collaborative", "Mixed"]);

// Score one spot for the "right now" list. Lower is better. Returns null if it shouldn't be suggested.
// opts: { profile, from: {lat, lon} | null, now: Date, needMinutes, prefs: {quiet, group, outlets, food}, busy? }
export function scoreSpot(spot, opts, ctx, buildings) {
  if (!spot.walkIn) return null;
  const acc = access(spot, opts.profile);
  if (!acc.ok) return null;
  const st = openStatus(spot, opts.now, ctx);
  if (st.open !== true) return null; // never suggest a spot we can't confirm is open
  const minutesLeft = st.always ? Infinity : Math.round((st.until - opts.now) / 60000);
  if (minutesLeft < Math.min(opts.needMinutes, 30)) return null;

  const b = spot.building ? buildings[spot.building] : null;
  const walk = opts.from && b ? walkMinutes(opts.from, b) : null;
  let score = walk ?? 10;
  const reasons = [];
  const warnings = [];
  if (walk != null) reasons.push(`${walk} min walk`);
  reasons.push(openLabel(st, opts.now));

  const { quiet, group, outlets, food } = opts.prefs;
  if (quiet) {
    if (spot.noise === "Silent" || spot.noise === "Quiet") reasons.push(spot.noise.toLowerCase());
    else if (LOUD.has(spot.noise)) score += 12;
    else score += 5;
  }
  if (group) {
    if (spot.noise === "Silent") score += 15;
    else if (spot.noise === "Quiet") score += 8;
    else if (LOUD.has(spot.noise)) reasons.push("good for groups");
    else score += 4;
  }
  if (!quiet && !group && spot.noise) {
    reasons.push(spot.noise.toLowerCase());
    // It's a study app: unless you ask for group space, lounges give way to study spaces a couple of minutes further.
    if (spot.noise === "Social") score += 3;
    else if (spot.noise === "Mixed") score += 2;
  }
  if (outlets) {
    if (spot.outlets === "yes") reasons.push("outlets");
    else if (spot.outlets === "limited") score += 10;
    else score += 4;
  }
  if (food) {
    if (spot.food === "yes") reasons.push("food OK");
    else if (spot.food === "no" || spot.food === "drinks") score += 12;
    else score += 3;
  }
  if (spot.status === "partial") score += 2;
  if (spot.status === "scout") score += 5;
  if (acc.unclear) { score += 6; warnings.push("Access not confirmed"); }
  if (spot.whoBasis === "assumed") score += 2;
  if (acc.mine) reasons.push("only for your group"); // shown, but no head start: being yours doesn't make it a better study spot
  if (minutesLeft < opts.needMinutes) { score += 6; warnings.push(`closes in ${minutesLeft} min`); }
  else if (minutesLeft < opts.needMinutes + 30) score += 3;
  if (spot.hours.dated) warnings.push("hours from an old source");
  if (spot.cardDoor) reasons.push("TCard at the door");

  // Crowd reports: a fresh "Full" all but rules a spot out; the usual pattern only nudges.
  const busy = opts.busy ? busyStatus(spot.id, opts.busy, opts.now) : null;
  if (busy?.kind === "live") score += { 1: -2, 2: 5, 3: 40 }[busy.level] ?? 0;
  if (busy?.kind === "typical") score += { 1: -1, 2: 2, 3: 6 }[busy.level] ?? 0;

  return { spot, score, walk, status: st, minutesLeft, reasons, warnings, mine: acc.mine, busy };
}

// Ranked suggestions, best first. The first `spread` picks come from different buildings.
export function rankSpots(spots, opts, ctx, buildings, spread = 3) {
  const scored = spots.map((s) => scoreSpot(s, opts, ctx, buildings)).filter(Boolean);
  scored.sort((a, b) => a.score - b.score || a.spot.name.localeCompare(b.spot.name));
  const top = [];
  const used = new Set();
  // Same official building code means the same building (Robarts and Robarts Common are both RL).
  const place = (s) => buildings[s.spot.building]?.code || s.spot.building;
  for (const s of scored) {
    if (top.length >= spread) break;
    if (used.has(place(s))) continue;
    top.push(s);
    used.add(place(s));
  }
  // Everything else keeps its score order, so a spot held back only to vary the top picks comes right after them.
  return [...top, ...scored.filter((s) => !top.includes(s))];
}

// "open until 9pm", or "open 24 hours" for spots that don't close this week.
export function openLabel(st, now) {
  return st.always ? "open 24 hours" : `open until ${fmtTime(st.until, now)}`;
}

export function fmtTime(d, now) {
  if (!d) return "";
  const h = d.getHours(), m = d.getMinutes();
  let s = h === 0 && m === 0 ? "midnight" : `${h % 12 || 12}${m ? ":" + String(m).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
  const days = Math.round((new Date(isoDate(d) + "T00:00:00") - new Date(isoDate(now) + "T00:00:00")) / 86400000);
  if (s === "midnight") return days <= 1 ? "midnight" : `midnight ${d.toLocaleDateString("en-CA", { weekday: "short" })}`;
  if (days === 1) return `${s} tomorrow`;
  if (days > 1) return `${s} ${d.toLocaleDateString("en-CA", { weekday: "short" })}`;
  return s;
}
