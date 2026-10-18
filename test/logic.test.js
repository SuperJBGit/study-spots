import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { access, parseClock, dayHours, openStatus, openLabel, walkMinutes, rankSpots, fmtTime } from "../src/logic.js";
import { indexFeed, loadLibraryHours } from "../src/hours.js";

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const { spots } = load("../data/spots.json");
const { buildings } = load("../data/buildings.json");
const calendar = load("../data/calendar.json");
// Real feed response, Oct 11-24, 2026 (Robarts, Robarts Common, Gerstein, ECSL, Kelly, OISE, Pratt).
const libcal = indexFeed(load("./fixtures/libcal-2026-10-11.json"));
const ctx = { libcal, calendar };
const spot = (id) => spots.find((s) => s.id === id);
const at = (iso) => new Date(iso); // local time, as on a phone in Toronto

const engsci = { fac: "eng", prog: "EngSci", col: "", res: "none", csc: false };
const innisCommuter = { fac: "as", prog: "", col: "Innis", res: "none", csc: false };
const visitor = { fac: "visitor", prog: "", col: "", res: "none", csc: false };

test("access follows faculty, program, college and residence", () => {
  assert.deepEqual(access(spot("eng-engsci"), engsci), { ok: true, mine: true, unclear: false });
  assert.equal(access(spot("eng-chem"), engsci).ok, false);
  assert.equal(access(spot("innis-commuter"), innisCommuter).mine, true);
  assert.equal(access(spot("innis-commuter"), engsci).ok, false);
  // Engineering students have no college, but living in New College residence opens its rooms
  assert.equal(access(spot("nc-multi"), { ...engsci, res: "NC" }).ok, true);
  // UC commuter centre needs UC membership and living off campus
  assert.equal(access(spot("uc-csc"), { ...innisCommuter, col: "UC" }).ok, true);
  assert.equal(access(spot("uc-csc"), { ...innisCommuter, col: "UC", res: "UC" }).ok, false);
  // Visitors only get public spots
  assert.equal(access(spot("kelly-3"), visitor).ok, true);
  assert.equal(access(spot("gerstein-rr"), visitor).ok, false);
  assert.equal(access(spot("myhal-8"), engsci).unclear, true);
});

test("parses LibCal clock times", () => {
  assert.equal(parseClock("8:30am"), 510);
  assert.equal(parseClock("12am"), 0);
  assert.equal(parseClock("12pm"), 720);
  assert.equal(parseClock("11:59pm"), 1439);
  assert.equal(parseClock("By appointment"), null);
});

test("day hours handle 24 h days, closures and missing holiday data", () => {
  assert.deepEqual(dayHours(spot("robarts-common"), "2026-10-14", ctx).intervals, [[0, 1440]]);
  assert.equal(dayHours(spot("robarts-floors"), "2026-10-12", ctx).state, "closed"); // Thanksgiving, in the feed
  // Kelly's feed shows Thanksgiving as a normal day; the closure calendar overrides it
  assert.equal(dayHours(spot("kelly-3"), "2026-10-12", ctx).state, "closed");
  assert.equal(dayHours(spot("kelly-3"), "2026-10-13", ctx).state, "open");
  // Fixed weekly hours close on university closure days too
  assert.equal(dayHours(spot("myhal-5"), "2026-10-12", ctx).state, "closed");
  assert.deepEqual(dayHours(spot("myhal-5"), "2026-10-17", ctx).intervals, [[480, 1200]]); // Saturday 8am-8pm
  assert.equal(dayHours(spot("bahen-cssu"), "2026-10-14", ctx).state, "unknown");
});

test("Robarts Common's 24 h days chain into one opening", () => {
  const st = openStatus(spot("robarts-common"), at("2026-10-14T03:00:00"), ctx);
  assert.equal(st.open, true);
  assert.equal(st.until.toString(), at("2026-10-16T23:00:00").toString()); // Friday 11pm
  const sun = openStatus(spot("robarts-common"), at("2026-10-18T23:30:00"), ctx);
  assert.equal(sun.open, true);
  assert.equal(sun.until.toString(), at("2026-10-23T23:00:00").toString());
});

test("spots open all week say so instead of inventing a closing time", () => {
  const now = at("2026-10-21T14:10:00");
  const st = openStatus(spot("eng-engsci"), now, ctx); // EngSci Common Room: 24/7 in term
  assert.equal(st.open, true);
  assert.equal(st.always, true);
  assert.equal(openLabel(st, now), "open 24 hours");
  // Robarts Common closes Friday night, so it keeps a real closing time
  assert.equal(openStatus(spot("robarts-common"), now, ctx).always, undefined);
});

test("closed spots report when they reopen", () => {
  const st = openStatus(spot("robarts-floors"), at("2026-10-19T23:30:00"), ctx);
  assert.equal(st.open, false);
  assert.equal(st.opensAt.toString(), at("2026-10-20T08:30:00").toString());
  assert.equal(openStatus(spot("robarts-floors"), at("2026-10-19T22:00:00"), ctx).open, true);
  assert.equal(openStatus(spot("bahen-cssu"), at("2026-10-19T12:00:00"), ctx).open, null);
});

test("temporarily closed spots stay closed and are never suggested", () => {
  const now = at("2026-10-20T14:10:00");
  const pit = spot("sf-pit");
  assert.ok(pit.closed);
  assert.equal(dayHours(pit, "2026-10-20", ctx).state, "closed");
  assert.deepEqual(openStatus(pit, now, ctx), { open: false, until: null, opensAt: null });
  // Even with made-up 24/7 hours, the closure wins
  const fake = { ...pit, hours: { type: "weekly", week: Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [["00:00", "24:00"]]])) } };
  assert.equal(openStatus(fake, now, ctx).open, false);
  const ranked = rankSpots(spots, { profile: engsci, from: buildings.sf, now, needMinutes: 30, prefs: {} }, ctx, buildings);
  assert.ok(!ranked.some((r) => r.spot.closed));
});

test("photo data points at real files and real spots", () => {
  const P = load("../data/photos.json");
  const ids = new Set(spots.map((s) => s.id));
  for (const [spotId, list] of Object.entries(P.spots)) {
    assert.ok(ids.has(spotId), `photos.json lists unknown spot ${spotId}`);
    assert.ok(Array.isArray(list) && list.length, `${spotId}: photos must be a non-empty list`);
    for (const id of list) assert.ok(P.photos[id], `${spotId}: missing photo ${id}`);
  }
  for (const [b, id] of Object.entries(P.buildings)) assert.ok(P.photos[id], `building ${b}: missing photo ${id}`);
  for (const p of Object.values(P.photos)) {
    assert.ok(existsSync(new URL(`../photos/${p.file}`, import.meta.url)), `missing file ${p.file}`);
    for (const k of ["alt", "caption", "artist", "license", "page"]) assert.ok(p[k], `${p.file}: no ${k}`);
  }
});

test("walking time is plausible across campus", () => {
  const w = walkMinutes(buildings.bahen, buildings.robarts); // about 550 m apart
  assert.ok(w >= 6 && w <= 12, `Bahen to Robarts: ${w} min`);
  assert.equal(walkMinutes(buildings.sf, buildings.sf), 1);
});

test("suggestions are open, usable, walk-in and from different buildings", () => {
  const now = at("2026-10-21T14:10:00"); // Wednesday afternoon
  const ranked = rankSpots(spots, {
    profile: engsci, from: buildings.bahen, now, needMinutes: 60,
    prefs: { quiet: true, group: false, outlets: true, food: false },
  }, ctx, buildings);
  assert.ok(ranked.length >= 3);
  const top = ranked.slice(0, 3);
  assert.equal(new Set(top.map((r) => buildings[r.spot.building].code)).size, 3);
  for (const r of ranked) {
    assert.equal(r.status.open, true, r.spot.id);
    assert.ok(r.spot.walkIn, r.spot.id);
    assert.ok(access(r.spot, engsci).ok, r.spot.id);
  }
  assert.ok(!ranked.some((r) => r.spot.id === "eng-chem"), "another program's room leaked in");
  assert.ok(!ranked.some((r) => r.spot.hours.type === "unknown"), "unknown hours suggested");
});

test("late at night only late spots come up", () => {
  const now = at("2026-10-21T23:40:00");
  const ranked = rankSpots(spots, {
    profile: engsci, from: buildings.bahen, now, needMinutes: 60,
    prefs: { quiet: false, group: false, outlets: false, food: false },
  }, ctx, buildings);
  const ids = ranked.map((r) => r.spot.id);
  assert.ok(ids.includes("robarts-common"));
  assert.ok(!ids.includes("gerstein-rr")); // Gerstein closes at 11pm
});

test("times read naturally", () => {
  const now = at("2026-10-21T14:00:00");
  assert.equal(fmtTime(at("2026-10-21T23:00:00"), now), "11pm");
  assert.equal(fmtTime(at("2026-10-21T21:30:00"), now), "9:30pm");
  assert.equal(fmtTime(at("2026-10-22T00:00:00"), now), "midnight");
  assert.equal(fmtTime(at("2026-10-23T23:00:00"), now), "11pm Fri");
});

test("hours cache: reuses today's copy, falls back to stale on failure", async () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const feed = load("./fixtures/libcal-2026-10-11.json");
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, json: async () => feed }; };
  const now = at("2026-10-14T09:00:00");
  const a = await loadLibraryHours({ fetchImpl: ok, storage, now });
  const b = await loadLibraryHours({ fetchImpl: ok, storage, now });
  assert.equal(calls, 1);
  assert.equal(b.stale, false);
  assert.ok(a.libcal[8315]);
  const fail = async () => { throw new Error("offline"); };
  const c = await loadLibraryHours({ fetchImpl: fail, storage, now: at("2026-10-15T09:00:00") });
  assert.equal(c.stale, true);
  assert.ok(c.libcal[8315]);
});
