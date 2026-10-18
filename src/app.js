import { access, openStatus, openLabel, dayHours, rankSpots, walkMinutes, fmtTime, isoDate, addDays, isClosureDay } from "./logic.js";
import { loadLibraryHours } from "./hours.js";

// ---------- small helpers ----------
const $ = (sel) => document.querySelector(sel);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: settings just won't stick */ } },
};
// ?now=2026-10-21T14:10 pins the clock, for testing other days and times.
const pinnedNow = new URLSearchParams(location.search).get("now");
const nowDate = () => (pinnedNow ? new Date(pinnedNow) : new Date());

const COLLEGES = { UC: "University College", Vic: "Victoria", Trin: "Trinity", SMC: "St. Michael’s", NC: "New College", Innis: "Innis", WDW: "Woodsworth" };
const PROGRAMS = { T1: "Track One (first year)", EngSci: "Engineering Science", ECE: "Electrical & Computer", Chem: "Chemical", Civ: "Civil", Min: "Mineral", Mech: "Mechanical", Indy: "Industrial", MSE: "Materials" };
const FACULTIES = { as: "Arts & Science", eng: "Engineering", md: "Medicine (MD)", other: "Other U of T faculty", visitor: "Not a U of T student" };
const SHORT_COL = { UC: "UC", Vic: "Vic", Trin: "Trinity", SMC: "St. Mike’s", NC: "New College", Innis: "Innis", WDW: "Woodsworth" };
const SHORT_PROG = { EngSci: "EngSci", ECE: "ECE", Chem: "Chem Eng", Civ: "Civil", Min: "Mineral", Mech: "Mech", Indy: "Industrial", MSE: "Materials" };

function ruleLabel(r) {
  if (r === "all") return "Anyone";
  if (r === "uoft") return "Any U of T student";
  if (r === "csc") return "CS students or anyone taking a CSC course";
  if (r === "md") return "MD students";
  if (r === "?") return "Not published";
  const [k, v] = r.split(":");
  if (k === "prog") return `${SHORT_PROG[v]} students`;
  if (k === "col") return `${SHORT_COL[v]} students`;
  if (k === "res") return `${SHORT_COL[v]} residents`;
  if (k === "comm") return `${SHORT_COL[v]} students who commute`;
  return r;
}

// ---------- state ----------
const state = {
  spots: [], buildings: {}, calendar: null,
  hours: { libcal: {}, fetchedAt: null, stale: true, error: null },
  profile: store.get("profile-v1", null),
  // "gps", a building key, or null on a first visit (then we try location, falling back to UC).
  near: store.get("near-v1", null),
  gps: null,
  gpsAccuracy: null,
  watchId: null,
  locStatus: "",
  farKm: null,
  photos: { photos: {}, spots: {}, buildings: {} },
  need: store.get("need-v1", 60),
  prefs: store.get("prefs-v1", { quiet: false, group: false, outlets: false, food: false }),
  saved: new Set(store.get("saved-v1", [])),
  skipped: new Set(),
  tab: "now",
  map: null, mapLayer: null,
};
const ctx = () => ({ libcal: state.hours.libcal, calendar: state.calendar });
const profile = () => state.profile || { fac: "other", prog: "", col: "", res: "none", csc: false };
const usingGps = () => state.near === "gps" && !!state.gps;
const fromPoint = () => (usingGps() ? state.gps : state.buildings[state.near] || state.buildings.uc);
const fromLabel = () => (usingGps() ? "your location" : (state.buildings[state.near] || state.buildings.uc).name);

// ---------- boot ----------
async function boot() {
  const [s, b, c] = await Promise.all(["data/spots.json", "data/buildings.json", "data/calendar.json"].map((u) => fetch(u).then((r) => r.json())));
  state.spots = s.spots;
  state.buildings = b.buildings;
  state.calendar = c;
  try { state.photos = await fetch("data/photos.json").then((r) => (r.ok ? r.json() : state.photos)); } catch { /* photos are optional */ }
  if (state.near && state.near !== "gps" && !state.buildings[state.near]) state.near = null;

  buildNearSelect();
  wireControls();
  renderFeedStatus();
  render();
  if (!state.profile) openOnboarding();
  // Ask for location straight away unless the student picked a building themselves:
  // the closest spots to where they are is the whole point of the Now screen.
  else if (state.near === "gps" || state.near === null) startLocation({ userAsked: false });

  state.hours = await loadLibraryHours({ now: nowDate() });
  renderFeedStatus();
  render();
  // Keep "open now" honest if the app stays open.
  setInterval(render, 60_000);
}

function renderFeedStatus() {
  const el = $("#feed-status");
  const h = state.hours;
  el.classList.toggle("bad", !!h.error);
  if (!h.fetchedAt && !h.error) el.textContent = "Loading library hours…";
  else if (!h.fetchedAt) el.textContent = "Library hours unavailable";
  else el.textContent = `Library hours ${h.stale ? "from " + h.fetchedAt.toLocaleDateString("en-CA", { month: "short", day: "numeric" }) : "updated " + fmtTime(h.fetchedAt, h.fetchedAt)}`;
}

// ---------- controls ----------
function buildNearSelect() {
  const sel = $("#near");
  const entries = Object.entries(state.buildings).sort((a, b) => a[1].name.localeCompare(b[1].name));
  sel.innerHTML = `<option value="gps">My location</option>` +
    entries.map(([k, v]) => `<option value="${k}">${esc(v.name)}${v.code ? " (" + v.code + ")" : ""}</option>`).join("");
  sel.value = nearValue();
}
const nearValue = () => (usingGps() || state.near === "gps" ? "gps" : state.near || "uc");

function wireControls() {
  $("#near").addEventListener("change", (e) => {
    const v = e.target.value;
    if (v === "gps") return startLocation({ userAsked: true });
    stopLocation();
    state.locStatus = "";
    state.near = v;
    store.set("near-v1", v);
    state.skipped.clear();
    render();
  });
  $("#locate").addEventListener("click", () => startLocation({ userAsked: true }));
  $("#see-all").addEventListener("click", () => {
    $("#x-open").checked = true;
    showTab("explore");
  });
  $("#need").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-min]");
    if (!b) return;
    state.need = Number(b.dataset.min);
    store.set("need-v1", state.need);
    state.skipped.clear();
    render();
  });
  $("#prefs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-pref]");
    if (!b) return;
    const k = b.dataset.pref;
    state.prefs[k] = !state.prefs[k];
    if (k === "quiet" && state.prefs.quiet) state.prefs.group = false;
    if (k === "group" && state.prefs.group) state.prefs.quiet = false;
    store.set("prefs-v1", state.prefs);
    state.skipped.clear();
    render();
  });
  $("#next").addEventListener("click", () => {
    const first = $("#picks .pick");
    if (first) state.skipped.add(first.dataset.id);
    render();
  });
  $("#reset-skips").addEventListener("click", () => { state.skipped.clear(); render(); });
  document.querySelector(".tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });
  ["#x-open", "#x-noise", "#x-q"].forEach((s) => $(s).addEventListener("input", renderExplore));
  $("#sheet-close").addEventListener("click", () => $("#sheet").close());
  $("#sheet").addEventListener("click", (e) => { if (e.target === $("#sheet")) $("#sheet").close(); });
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) { e.preventDefault(); openSheet(open.dataset.open); return; }
    const save = e.target.closest("[data-save]");
    if (save) { toggleSave(save.dataset.save); }
  });
}

// Location: watch the position while the app is open, so the closest spots update as you walk.
// The position stays on the device; it's only used to work out walking times.
// state.locStatus: "" | "finding" | "on" | "blocked" | "failed" | "unsupported" | "far"
// Shown under the Near picker, so a missing location never fails silently.
function startLocation({ userAsked }) {
  if (!navigator.geolocation) {
    state.locStatus = "unsupported";
    render();
    return;
  }
  stopLocation();
  state.locStatus = "finding";
  $("#locate").textContent = "Locating…";
  render();
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      $("#locate").textContent = "Update location";
      const fromCampus = walkMinutes(p, state.buildings.uc);
      if (fromCampus > 40) {
        // Off campus (at home, say): keep watching, but measure from UC until they get closer.
        state.locStatus = "far";
        state.farKm = Math.round(haversineMetres(p, state.buildings.uc) / 100) / 10;
        if (state.near === "gps") state.near = null;
        state.gps = null;
        render();
        return;
      }
      const moved = !state.gps || haversineMetres(state.gps, p) > 25;
      state.gps = p;
      state.gpsAccuracy = Math.round(pos.coords.accuracy);
      const switched = state.near !== "gps" || state.locStatus !== "on";
      state.locStatus = "on";
      if (state.near !== "gps") { state.near = "gps"; store.set("near-v1", "gps"); state.skipped.clear(); }
      if (moved || switched) render();
    },
    (err) => {
      stopLocation();
      $("#locate").textContent = "Use my location";
      state.locStatus = err.code === 1 ? "blocked" : "failed";
      if (state.near === "gps") state.near = null;
      if (userAsked && err.code === 1) alertBanner("Location is blocked for this site. Allow it in your browser’s site settings, then tap Use my location.");
      render();
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 },
  );
}
function nearNote() {
  const from = (state.buildings[state.near] || state.buildings.uc).name;
  switch (state.locStatus) {
    case "on": return usingGps() ? `Walk times from where you are${state.gpsAccuracy ? ` (±${state.gpsAccuracy} m)` : ""}.` : `Walk times from ${from}.`;
    case "finding": return "Finding you… If your browser asks, allow location.";
    case "far": return `You’re about ${state.farKm} km from campus, so walk times are from ${from} until you’re closer.`;
    case "blocked": return `Location is blocked for this site, so walk times are from ${from}. Allow it in your browser’s site settings, then tap Use my location.`;
    case "failed": return `Couldn’t find you, so walk times are from ${from}. Tap Use my location to try again.`;
    case "unsupported": return `This browser can’t share location, so walk times are from ${from}.`;
    default: return state.near && state.near !== "gps" ? `Walk times from ${from}.` : "";
  }
}
function stopLocation() {
  if (state.watchId != null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
}
function haversineMetres(a, b) {
  const rad = Math.PI / 180, R = 6371000;
  const h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let bannerMsg = "";
function alertBanner(msg) { bannerMsg = msg; render(); setTimeout(() => { bannerMsg = ""; render(); }, 6000); }

function showTab(tab) {
  state.tab = tab;
  for (const t of ["now", "explore", "saved", "you"]) {
    $(`#view-${t}`).hidden = t !== tab;
    document.querySelector(`.tabbar [data-tab="${t}"]`).toggleAttribute("aria-current", t === tab);
    if (t === tab) document.querySelector(`.tabbar [data-tab="${t}"]`).setAttribute("aria-current", "page");
  }
  render();
  window.scrollTo(0, 0);
}

// ---------- render ----------
function render() {
  $("#near").value = nearValue();
  $("#near-note").textContent = nearNote();
  document.querySelectorAll("#need button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.min) === state.need)));
  document.querySelectorAll("#prefs button").forEach((b) => b.setAttribute("aria-pressed", String(!!state.prefs[b.dataset.pref])));
  if (state.tab === "now") renderNow();
  if (state.tab === "explore") renderExplore();
  if (state.tab === "saved") renderSaved();
  if (state.tab === "you") renderYou();
}

function statusTag(spot, now) {
  const st = openStatus(spot, now, ctx());
  if (st.open === true) return { st, html: `<span class="tag open">${esc(cap(openLabel(st, now)))}</span>` };
  if (st.open === false) return { st, html: `<span class="tag closed">Closed${st.opensAt ? " · opens " + esc(fmtTime(st.opensAt, now)) : ""}</span>` };
  return { st, html: `<span class="tag unknown">Hours unknown</span>` };
}

function renderNow() {
  const now = nowDate();
  const banner = [];
  if (bannerMsg) banner.push(bannerMsg);
  if (isClosureDay(isoDate(now), state.calendar)) banner.push("The university is closed today, so most spots are shut.");
  if (state.hours.error && !state.hours.fetchedAt) banner.push("Library hours couldn’t load, so libraries are left out of suggestions for now.");
  $("#now-banner").innerHTML = banner.map((m) => `<p class="banner">${esc(m)}</p>`).join("");

  const ranked = rankSpots(
    state.spots.filter((s) => !state.skipped.has(s.id)),
    { profile: profile(), from: fromPoint(), now, needMinutes: state.need, prefs: state.prefs },
    ctx(), state.buildings,
  );
  const top = ranked.slice(0, 3);
  $("#picks").innerHTML = top.length
    ? top.map((r) => pickCard(r, now)).join("")
    : `<li class="empty">Nothing we can confirm is open for that long right now. Try less time, fewer preferences, or Explore for spots with unpublished hours.</li>`;
  $("#next").hidden = ranked.length <= 1;
  $("#reset-skips").hidden = state.skipped.size === 0;

  // Members-only rooms with unpublished hours: the app's niche, shown honestly.
  const from = fromPoint();
  const also = state.spots
    .filter((s) => s.walkIn && s.hours.type === "unknown" && access(s, profile()).mine)
    .map((s) => ({ s, walk: walkMinutes(from, state.buildings[s.building]) }))
    .filter((x) => x.walk != null && x.walk <= 15)
    .sort((a, b) => a.walk - b.walk)
    .slice(0, 4);
  $("#also").hidden = also.length === 0;
  $("#also-list").innerHTML = also
    .map(({ s, walk }) => `<li><a href="#" data-open="${s.id}">${esc(s.name)}</a> <span class="hint">· ${walk} min · ${esc(s.who.map(ruleLabel).join(" or "))}</span></li>`)
    .join("");
}

function pickCard(r, now) {
  const s = r.spot;
  const b = state.buildings[s.building];
  const tags = [`<span class="tag open">${esc(cap(openLabel(r.status, now)))}</span>`];
  for (const reason of r.reasons) {
    if (/min walk|^open /.test(reason)) continue;
    tags.push(`<span class="tag${reason === "only for your group" ? " you" : ""}">${esc(reason)}</span>`);
  }
  for (const w of r.warnings) tags.push(`<span class="tag warn">${esc(w)}</span>`);
  const ph = photoFor(s);
  return `<li class="pick" data-id="${s.id}">
    ${ph ? `<button type="button" class="photo-btn" data-open="${s.id}" aria-label="Details for ${esc(s.name)}"><img class="photo" src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="lazy">${ph.outside ? `<span class="photo-label">Outside</span>` : ""}</button>` : ""}
    <div class="pick-head">
      <div><h3>${esc(s.name)}</h3><p class="where">${esc(b ? b.name : s.where)}</p></div>
      <div class="walk">${r.walk ?? "?"} min<small>walk</small></div>
    </div>
    <div class="tags">${tags.join("")}</div>
    <div class="card-actions">
      ${b ? `<a class="btn small" href="${directionsUrl(b)}" target="_blank" rel="noopener">Directions</a>` : ""}
      <button type="button" class="btn small ghost" data-open="${s.id}">Details</button>
      <button type="button" class="btn small ghost" data-save="${s.id}" aria-pressed="${state.saved.has(s.id)}">${state.saved.has(s.id) ? "Saved" : "Save"}</button>
    </div>
  </li>`;
}

const directionsUrl = (b) => `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking`;

// An inside photo of the spot when we have one; otherwise the outside of its building, labelled "Outside".
function photoFor(s) {
  const P = state.photos;
  const inside = P.photos?.[P.spots?.[s.id]];
  const p = inside || P.photos?.[P.buildings?.[s.building]];
  if (!p) return null;
  return { ...p, src: `photos/${p.file}`, alt: p.alt || s.name, outside: !inside };
}
function photoCredit(p) {
  return `Photo: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.artist)}</a>, ` +
    (p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)) +
    `, via ${esc(p.via || "Wikimedia Commons")}`;
}

function usableSpots() {
  return state.spots.filter((s) => access(s, profile()).ok);
}

function listRow(s, now, from) {
  const { html } = statusTag(s, now);
  const b = state.buildings[s.building];
  const walk = b && from ? walkMinutes(from, b) : null;
  const acc = access(s, profile());
  const extra = [];
  if (acc.mine) extra.push(`<span class="tag you">Yours</span>`);
  if (acc.unclear) extra.push(`<span class="tag unknown">Access unclear</span>`);
  if (s.noise) extra.push(`<span class="tag">${esc(s.noise)}</span>`);
  if (!s.walkIn) extra.push(`<span class="tag">Book or check first</span>`);
  const ph = photoFor(s);
  return `<li><button type="button" class="row-item${ph ? " has-thumb" : ""}" data-open="${s.id}">
    ${ph ? `<img class="thumb" src="${esc(ph.src)}" alt="" loading="lazy">` : ""}
    <span><span class="name">${esc(s.name)}</span><br><span class="meta">${esc(b ? b.name : s.where)}</span></span>
    <span class="side">${walk != null ? walk + " min" : ""}</span>
    <span class="tags">${html}${extra.join("")}</span>
  </button></li>`;
}

function renderExplore() {
  const now = nowDate();
  const from = fromPoint();
  const onlyOpen = $("#x-open").checked;
  const noise = $("#x-noise").value;
  const q = $("#x-q").value.trim().toLowerCase();
  const rows = usableSpots()
    .filter((s) => !noise || s.noise === noise)
    .filter((s) => !q || `${s.name} ${s.where} ${s.notes} ${state.buildings[s.building]?.name ?? ""}`.toLowerCase().includes(q))
    .map((s) => ({ s, st: openStatus(s, now, ctx()), walk: s.building ? walkMinutes(from, state.buildings[s.building]) : 999 }))
    .filter((x) => !onlyOpen || x.st.open === true)
    .sort((a, b) => a.walk - b.walk || a.s.name.localeCompare(b.s.name));
  $("#x-count").textContent = `${rows.length} spot${rows.length === 1 ? "" : "s"} you can use · closest first from ${fromLabel()}`;
  $("#x-list").innerHTML = rows.map(({ s }) => listRow(s, now, from)).join("") || `<li class="empty">No spots match.</li>`;
  renderMap(rows, now);
}

function renderMap(rows, now) {
  if (!window.L) { $("#map").innerHTML = `<p class="empty" style="padding:12px">The map couldn’t load. The list below still works.</p>`; return; }
  if (!state.map) {
    state.map = L.map("map", { scrollWheelZoom: false }).setView([43.6628, -79.3957], 15);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(state.map);
    state.mapLayer = L.layerGroup().addTo(state.map);
  }
  setTimeout(() => state.map.invalidateSize(), 0);
  state.mapLayer.clearLayers();
  const byBuilding = new Map();
  for (const r of rows) {
    if (!r.s.building) continue;
    if (!byBuilding.has(r.s.building)) byBuilding.set(r.s.building, []);
    byBuilding.get(r.s.building).push(r);
  }
  for (const [key, list] of byBuilding) {
    const b = state.buildings[key];
    const anyOpen = list.some((r) => r.st.open === true);
    const icon = L.divIcon({ className: "", html: `<div class="pin ${anyOpen ? "open" : "closed"}"></div>`, iconSize: [14, 14] });
    const html = `<b>${esc(b.name)}</b><br>` + list.map((r) => `<button type="button" class="btn link" data-open="${r.s.id}">${esc(r.s.name)}</button>`).join("<br>");
    L.marker([b.lat, b.lon], { icon, title: b.name }).bindPopup(html).addTo(state.mapLayer);
  }
  const from = fromPoint();
  if (from) L.marker([from.lat, from.lon], { icon: L.divIcon({ className: "", html: `<div class="pin here"></div>`, iconSize: [16, 16] }), title: usingGps() ? "You" : fromLabel() }).addTo(state.mapLayer);
  // Follow the student the first time we know where they are.
  if (usingGps() && !state.mapCentredOnGps) {
    state.map.setView([from.lat, from.lon], 16);
    state.mapCentredOnGps = true;
  }
}

function renderSaved() {
  const now = nowDate();
  const from = fromPoint();
  const list = state.spots.filter((s) => state.saved.has(s.id));
  $("#saved-list").innerHTML = list.map((s) => listRow(s, now, from)).join("");
  $("#saved-empty").hidden = list.length > 0;
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  store.set("saved-v1", [...state.saved]);
  render();
  if ($("#sheet").open) openSheet(id);
}

// ---------- spot detail ----------
function openSheet(id) {
  const s = state.spots.find((x) => x.id === id);
  if (!s) return;
  const now = nowDate();
  const b = state.buildings[s.building];
  const { html: tag } = statusTag(s, now);
  const days = [];
  for (let k = 0; k < 7; k++) {
    const d = addDays(now, k);
    const iso = isoDate(d);
    const h = dayHours(s, iso, ctx());
    let txt;
    if (h.state === "open") txt = h.intervals.map(([a, z]) => (a === 0 && z >= 1440 ? "24 hours" : `${clock(a)}–${clock(z)}`)).join(", ");
    else if (h.state === "closed") txt = "Closed" + (h.note ? ` (${String(h.note).trim()})` : "");
    else if (h.state === "appointment") txt = "By appointment";
    else txt = "Unknown";
    days.push(`<tr class="${k === 0 ? "today" : ""}"><td>${k === 0 ? "Today" : d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })}</td><td>${esc(txt)}</td></tr>`);
  }
  const acc = access(s, profile());
  const hoursNote = s.hours.type === "libcal"
    ? "From U of T Libraries’ live hours."
    : s.hours.type === "weekly"
      ? `From ${esc(s.hours.asOf)}.${s.hours.dated ? " This source is old, so check on site." : ""}`
      : `Hours aren’t published${s.hoursText && !/^Not published/.test(s.hoursText) ? `: ${esc(s.hoursText)}` : ""}.`;
  const facts = [
    ["Who can use it", esc(s.who.map(ruleLabel).join(" or ")) + (s.whoBasis === "assumed" ? " (assumed from the college’s wording)" : "") + (acc.mine ? ` <span class="tag you">Yours</span>` : "")],
    ["Door", s.cardDoor ? "TCard or fob needed to get in" : "No card reader known"],
    ["Noise", s.noise ? esc(s.noise) + (s.noiseOfficial ? " (official library label)" : "") : "Not stated"],
    ["Outlets", s.outlets === "yes" ? "Yes" : s.outlets === "limited" ? "Very limited" : "Unknown"],
    ["Food", s.food === "yes" ? "Allowed" : s.food === "no" ? "Not allowed" : s.food === "drinks" ? "Covered drinks only" : "Unknown"],
    ["Where", esc(s.where) + (b ? `<br><span class="hint">${esc(b.address)}${b.approx || s.locationApprox ? " · map pin is approximate" : ""}</span>` : "")],
  ];
  const ph = photoFor(s);
  const walk = b ? walkMinutes(fromPoint(), b) : null;
  $("#sheet-body").innerHTML = `<div class="sheet">
    ${ph ? `<figure class="sheet-photo"><img src="${esc(ph.src)}" alt="${esc(ph.alt)}"><figcaption>${ph.caption ? `${esc(ph.caption)}. ` : ""}${photoCredit(ph)}</figcaption></figure>` : ""}
    <h2 id="sheet-h">${esc(s.name)}</h2>
    ${walk != null ? `<p class="hint">${walk} min walk from ${esc(fromLabel())}</p>` : ""}
    <div class="tags" style="margin-top:8px">${tag}${s.status === "scout" ? `<span class="tag warn">Not yet checked on site</span>` : ""}</div>
    <p style="margin-top:10px">${esc(s.notes)}</p>
    <div class="card-actions" style="margin-top:12px">
      ${b ? `<a class="btn small" href="${directionsUrl(b)}" target="_blank" rel="noopener">Directions</a>` : ""}
      ${s.bookUrl ? `<a class="btn small ghost" href="${esc(s.bookUrl)}" target="_blank" rel="noopener">Book a room</a>` : ""}
      <button type="button" class="btn small ghost" data-save="${s.id}" aria-pressed="${state.saved.has(s.id)}">${state.saved.has(s.id) ? "Saved" : "Save"}</button>
    </div>
    <h3 style="margin-top:18px">Hours</h3>
    <table class="hours-table"><tbody>${days.join("")}</tbody></table>
    <p class="hint" style="margin-top:6px">${hoursNote}</p>
    <dl class="kv" style="margin-top:14px">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <h3 style="margin-top:18px">Sources</h3>
    <ul class="sources">${s.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("") || "<li>No official page found</li>"}</ul>
  </div>`;
  if (!$("#sheet").open) $("#sheet").showModal();
}
const clock = (m) => {
  const mm = ((m % 1440) + 1440) % 1440;
  if (mm === 0) return "midnight";
  const h = Math.floor(mm / 60), min = mm % 60;
  return `${h % 12 || 12}${min ? ":" + String(min).padStart(2, "0") : ""}${h < 12 ? "am" : "pm"}`;
};

// ---------- profile ----------
function profileFields(p, idp) {
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}"${k === cur ? " selected" : ""}>${esc(v)}</option>`).join("");
  return `
    <label class="field"><span>Faculty</span><select id="${idp}-fac">${opt(FACULTIES, p.fac)}</select></label>
    <label class="field" id="${idp}-prog-wrap"><span>Engineering program</span><select id="${idp}-prog">${opt(PROGRAMS, p.prog || "T1")}</select></label>
    <label class="field" id="${idp}-col-wrap"><span>College</span><select id="${idp}-col"><option value="">Choose your college</option>${opt(COLLEGES, p.col)}</select></label>
    <label class="field"><span>Where you live</span><select id="${idp}-res"><option value="none"${p.res === "none" ? " selected" : ""}>Off campus (I commute)</option>${Object.entries(COLLEGES).map(([k, v]) => `<option value="${k}"${p.res === k ? " selected" : ""}>${esc(v)} residence</option>`).join("")}<option value="other"${p.res === "other" ? " selected" : ""}>Another residence</option></select></label>
    <label class="check"><input type="checkbox" id="${idp}-csc"${p.csc ? " checked" : ""}> I’m in CS or taking a CSC course</label>`;
}
function readProfile(idp) {
  const v = (s) => document.getElementById(`${idp}-${s}`);
  const fac = v("fac").value;
  return { fac, prog: fac === "eng" ? v("prog").value : "", col: fac === "as" ? v("col").value : "", res: v("res").value, csc: v("csc").checked };
}
function syncProfileFields(idp) {
  const fac = document.getElementById(`${idp}-fac`).value;
  document.getElementById(`${idp}-prog-wrap`).hidden = fac !== "eng";
  document.getElementById(`${idp}-col-wrap`).hidden = fac !== "as";
}

function openOnboarding() {
  const p = { fac: "as", prog: "", col: "", res: "none", csc: false };
  $("#onboard-fields").innerHTML = profileFields(p, "ob");
  syncProfileFields("ob");
  $("#ob-fac").addEventListener("change", () => syncProfileFields("ob"));
  const dlg = $("#onboard");
  dlg.addEventListener("close", () => {
    state.profile = dlg.returnValue === "save" ? readProfile("ob") : { fac: "other", prog: "", col: "", res: "none", csc: false };
    store.set("profile-v1", state.profile);
    render();
    // Then ask for location, so the first list is the closest spots to where they are.
    if (state.near === null || state.near === "gps") startLocation({ userAsked: false });
  }, { once: true });
  dlg.showModal();
}

function renderYou() {
  const form = $("#profile-form");
  if (form.dataset.ready) return;
  form.dataset.ready = "1";
  form.innerHTML = profileFields(profile(), "pf") + `<div class="actions"><button class="btn" type="submit">Save</button><span class="hint" id="pf-msg" aria-live="polite"></span></div>`;
  syncProfileFields("pf");
  $("#pf-fac").addEventListener("change", () => syncProfileFields("pf"));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    state.profile = readProfile("pf");
    store.set("profile-v1", state.profile);
    $("#pf-msg").textContent = "Saved. Your spots are updated.";
    state.skipped.clear();
  });
}

// Installable app + offline fallback. Skipped inside the Android wrapper's local files, where it isn't needed.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works without it */ });
}

boot().catch((e) => {
  $("#picks").innerHTML = `<li class="empty">Something went wrong loading the spot data (${esc(e.message)}). Reload to try again.</li>`;
});
