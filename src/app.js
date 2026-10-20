import { access, openStatus, openLabel, dayHours, rankSpots, walkMinutes, fmtTime, isoDate, addDays, isClosureDay, metresBetween, buildingsHere, busyStatus, busyLabel, typicalDay, BUSY_LEVELS } from "./logic.js";
import { loadLibraryHours } from "./hours.js";
import { crowdEnabled, fetchBusy, sendReport, sendEvent, sendPhoto, preparePhoto } from "./crowd.js";

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
  hidden: new Set(store.get("hidden-v1", [])), // spots you never want suggested
  showHidden: false,
  skipped: new Set(),
  tab: "now",
  map: null, mapLayer: null,
  picksKey: "",
  // Crowd data (src/crowd.js): busyness from the backend, and whether you're doing headcount walks.
  busy: null, busyAt: 0,
  contributor: store.get("contributor-v1", false),
  credit: store.get("credit-v1", ""),
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
  startRouting();
  if (!state.profile) openOnboarding();
  // Ask for location straight away unless the student picked a building themselves:
  // the closest spots to where they are is the whole point of the Now screen.
  else if (state.near === "gps" || state.near === null) startLocation({ userAsked: false });

  refreshBusy();
  state.hours = await loadLibraryHours({ now: nowDate() });
  renderFeedStatus();
  render();
  // Keep "open now" honest if the app stays open, and busyness at most 5 minutes old.
  setInterval(() => {
    render();
    if (Date.now() - state.busyAt > 5 * 60000) refreshBusy();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.busyAt > 2 * 60000) refreshBusy();
  });
}

async function refreshBusy() {
  if (!crowdEnabled()) return;
  state.busyAt = Date.now();
  try { state.busy = await fetchBusy(); render(); } catch { /* keep what we had; the app works without it */ }
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
    if (first) {
      state.skipped.add(first.dataset.id);
      // Standing at a full spot and asking for the next one is the most honest busyness report there is.
      const spot = state.spots.find((s) => s.id === first.dataset.id);
      if (crowdEnabled() && spot && isHere(spot)) report(spot.id, 3, "next-button");
    }
    render();
  });
  $("#reset-skips").addEventListener("click", () => { state.skipped.clear(); render(); });
  document.querySelector(".tabbar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });
  ["#x-open", "#x-noise", "#x-q"].forEach((s) => $(s).addEventListener("input", renderExplore));
  $("#sheet-close").addEventListener("click", closeSheet);
  $("#sheet").addEventListener("click", (e) => { if (e.target === $("#sheet")) closeSheet(); });
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) { e.preventDefault(); openSheet(open.dataset.open); return; }
    const save = e.target.closest("[data-save]");
    if (save) { toggleSave(save.dataset.save); return; }
    const hide = e.target.closest("[data-hide]");
    if (hide) { toggleHide(hide.dataset.hide); return; }
    if (e.target.closest("[data-show-hidden]")) { state.showHidden = !state.showHidden; renderExplore(); return; }
    const step = e.target.closest("[data-step]");
    if (step) {
      const strip = step.parentElement.querySelector(".sheet-photos");
      strip.scrollBy({ left: Number(step.dataset.step) * strip.clientWidth, behavior: "smooth" });
      return;
    }
    // Heading somewhere: remember it, so "how busy is it here?" can ask about that spot when you arrive.
    const dir = e.target.closest("[data-dir]");
    if (dir) store.set("recent-spot-v1", { id: dir.dataset.dir, at: Date.now() });
    const level = e.target.closest("[data-report-level]");
    if (level) {
      const spot = state.spots.find((s) => s.id === level.dataset.spot);
      const people = $("#report-people")?.value;
      report(spot.id, Number(level.dataset.reportLevel), isHere(spot) ? "sheet" : "contributor", people === "" ? undefined : people)
        .then((ok) => { if (ok && $("#sheet").open) { openSheet(spot.id); $("#report-thanks")?.removeAttribute("hidden"); } });
      return;
    }
    if (e.target.closest("[data-here-spot]")) { prompt.spot = e.target.closest("[data-here-spot]").dataset.hereSpot; render(); return; }
    if (e.target.closest("[data-here-change]")) { prompt.spot = null; render(); return; }
    if (e.target.closest("[data-here-level]")) { answerPrompt(Number(e.target.closest("[data-here-level]").dataset.hereLevel)); return; }
    if (e.target.closest("[data-here-close]")) { sendEvent("prompt_dismissed", prompt?.spot || undefined); prompt = null; render(); }
  });
  // Photo uploads: prepare (shrink, strip camera data) as soon as a file is picked, send on submit.
  document.addEventListener("change", async (e) => {
    const input = e.target.closest(".photo-form input[type=file]");
    if (!input?.files?.[0]) return;
    const form = input.closest("form");
    const status = form.querySelector(".photo-status");
    status.textContent = "Preparing the photo…";
    try {
      form.photo = await preparePhoto(input.files[0]);
      const img = form.querySelector(".photo-preview");
      img.src = form.photo.preview;
      img.hidden = false;
      status.textContent = "";
    } catch {
      form.photo = null;
      status.textContent = "That file couldn’t be read as a photo.";
    }
  });
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest(".photo-form");
    if (!form) return;
    e.preventDefault();
    const status = form.querySelector(".photo-status");
    if (!form.photo) { status.textContent = "Choose a photo first."; return; }
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "Sending…";
    const credit = form.credit.value.trim();
    state.credit = credit;
    store.set("credit-v1", credit);
    try {
      const res = await sendPhoto(form.dataset.photoForm, form.photo.data, form.caption.value.trim(), credit);
      if (!res.ok) throw new Error(res.error);
      sendEvent("photo_sent", form.dataset.photoForm);
      form.reset();
      form.photo = null;
      form.querySelector(".photo-preview").hidden = true;
      status.textContent = "Sent for review. It’ll show here once it’s approved. Thank you!";
    } catch (err) {
      status.textContent = `Couldn’t send it${err.message && !/fetch/i.test(err.message) ? ` (${err.message})` : ""}. Check your connection and try again.`;
    } finally {
      button.disabled = false;
    }
  });
}

// ---------- crowd reports ----------

// Are you at this spot's building right now? Needs a GPS fix good enough to tell neighbouring buildings apart.
const isHere = (spot) => usingGps() && buildingsHere(state.gps, state.gpsAccuracy, state.buildings).some((b) => b.key === spot.building);

// Send a report and show it straight away (the backend's view refreshes within a minute anyway).
async function report(spotId, level, source, people) {
  try {
    const res = await sendReport(spotId, level, source, people);
    if (!res.ok) throw new Error(res.error);
    state.busy ||= { live: {}, typical: {} };
    const prev = state.busy.live[spotId];
    state.busy.live[spotId] = { level, at: nowDate().toISOString(), n: (prev?.n || 0) + 1 };
    render();
    return true;
  } catch {
    alertBanner("Couldn’t send that report. Check your connection.");
    return false;
  }
}

// "How busy is it here?": asked on the Now screen when GPS puts you at a building with spots,
// at most once per building every 3 hours and 4 times a day. One tap to answer, one to dismiss.
let prompt = null; // { building, spots: [ids], spot: id | null, thanks: bool }

function updatePrompt() {
  if (prompt || !crowdEnabled() || state.locStatus !== "on" || !usingGps() || $("#onboard").open) return;
  const now = nowDate();
  const here = buildingsHere(state.gps, state.gpsAccuracy, state.buildings);
  const cands = here.flatMap(({ key }) => state.spots.filter((s) =>
    s.building === key && !state.hidden.has(s.id) && s.walkIn && access(s, profile()).ok && openStatus(s, now, ctx()).open !== false));
  if (!cands.length) return;
  const log = store.get("prompt-log-v1", { day: "", count: 0, at: {} });
  const today = isoDate(now);
  if (log.day !== today) Object.assign(log, { day: today, count: 0 });
  const building = cands[0].building;
  if (log.count >= 4 || Date.now() - (log.at[building] || 0) < 3 * 3600e3) return;
  log.count += 1;
  log.at[building] = Date.now();
  store.set("prompt-log-v1", log);
  // If you opened or got directions to one of these spots in the last 2 hours, ask about that one directly.
  const recent = store.get("recent-spot-v1", null);
  const pre = recent && Date.now() - recent.at < 2 * 3600e3 ? cands.find((s) => s.id === recent.id) : null;
  const ordered = pre ? [pre, ...cands.filter((s) => s !== pre)] : cands;
  prompt = { building, spots: ordered.slice(0, 4).map((s) => s.id), spot: pre ? pre.id : cands.length === 1 ? cands[0].id : null, thanks: false };
  sendEvent("prompt_shown", prompt.spot || undefined, String(cands.length));
}

function promptHtml() {
  if (!prompt) return "";
  if (prompt.thanks) return `<section class="here thanks" role="status"><p class="here-q">Thanks! Everyone sees that for the next 45 minutes.</p></section>`;
  const name = (id) => esc(state.spots.find((s) => s.id === id)?.name);
  const head = prompt.spot
    ? `How busy is <b>${name(prompt.spot)}</b> right now?`
    : `You’re at <b>${esc(state.buildings[prompt.building].name)}</b>. Which spot are you in?`;
  const body = prompt.spot
    ? `<div class="levels">${[1, 2, 3].map((l) => `<button type="button" class="lv${l}" data-here-level="${l}">${BUSY_LEVELS[l]}</button>`).join("")}</div>` +
      (prompt.spots.length > 1 ? `<button type="button" class="btn link" data-here-change>Not this spot?</button>` : "")
    : `<div class="here-spots">${prompt.spots.map((id) => `<button type="button" data-here-spot="${id}">${name(id)}</button>`).join("")}</div>`;
  return `<section class="here" aria-label="Report how busy it is"><p class="here-q">${head}</p>${body}<button type="button" class="here-close" data-here-close aria-label="Not now">×</button></section>`;
}

function answerPrompt(level) {
  const spot = prompt.spot;
  sendEvent("prompt_answered", spot, String(level));
  report(spot, level, "prompt");
  prompt.thanks = true;
  render();
  setTimeout(() => { prompt = null; render(); }, 4000);
}

const busyChip = (b) => (b ? `<span class="busy lv${b.level}${b.kind === "typical" ? " usual" : ""}">${esc(busyLabel(b))}</span>` : "");

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
  $("#locate .locate-label").textContent = "Locating…";
  render();
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const p = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      $("#locate .locate-label").textContent = "Update location";
      const fromCampus = walkMinutes(p, state.buildings.uc);
      if (fromCampus > 40) {
        // Off campus (at home, say): keep watching, but measure from UC until they get closer.
        state.locStatus = "far";
        state.farKm = Math.round(metresBetween(p, state.buildings.uc) / 100) / 10;
        if (state.near === "gps") state.near = null;
        state.gps = null;
        render();
        return;
      }
      const moved = !state.gps || metresBetween(state.gps, p) > 25;
      state.gps = p;
      state.gpsAccuracy = Math.round(pos.coords.accuracy);
      const switched = state.near !== "gps" || state.locStatus !== "on";
      state.locStatus = "on";
      if (state.near !== "gps") { state.near = "gps"; store.set("near-v1", "gps"); state.skipped.clear(); }
      if (moved || switched) render();
    },
    (err) => {
      stopLocation();
      $("#locate .locate-label").textContent = "Use my location";
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
let bannerMsg = "";
function alertBanner(msg) { bannerMsg = msg; render(); setTimeout(() => { bannerMsg = ""; render(); }, 6000); }

// ---------- back button ----------
// Each tab and each open spot is a history entry, so the phone's back button (and the browser's) closes the spot,
// then returns to the previous tab, instead of leaving the app. URLs: #explore, #explore/robarts-floors; Now has no hash.
const TABS = ["now", "explore", "saved", "you"];
const routeUrl = (tab, spot) => location.pathname + location.search + (tab === "now" && !spot ? "" : `#${tab}${spot ? "/" + spot : ""}`);
const pushRoute = (tab, spot = null) => history.pushState({ tab, spot }, "", routeUrl(tab, spot));
function parseRoute(hash) {
  const [tab, spot] = decodeURIComponent(hash.replace(/^#/, "")).split("/");
  return { tab: TABS.includes(tab) ? tab : "now", spot: spot || null };
}
let pendingSpot = null;
function startRouting() {
  const r = parseRoute(location.hash);
  history.replaceState({ tab: r.tab, spot: null }, "", routeUrl(r.tab));
  if (r.tab !== "now") showTab(r.tab, { push: false });
  // A link straight to a spot: open it on top of its tab, so back closes it rather than leaving.
  // On a first visit, open it once the "which rooms can you use?" questions are answered.
  if (r.spot && state.spots.some((s) => s.id === r.spot)) {
    if (state.profile) openSheet(r.spot);
    else pendingSpot = r.spot;
  }
  window.addEventListener("popstate", (e) => {
    const to = e.state || parseRoute(location.hash);
    if ($("#sheet").open && !to.spot) $("#sheet").close();
    if (to.tab !== state.tab) showTab(to.tab, { push: false });
    if (to.spot && !$("#sheet").open) openSheet(to.spot, { push: false });
  });
  // Esc goes through closeSheet too; the close listener is a fallback for any other way the dialog closes.
  $("#sheet").addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(); });
  $("#sheet").addEventListener("close", () => { if (history.state?.spot) history.back(); });
}
// Closing a spot (×, tapping outside, Esc) steps history back, and popstate closes the dialog,
// so the next back press doesn't land on the spot that was just closed.
function closeSheet() {
  if (history.state?.spot) history.back();
  else $("#sheet").close();
}

function showTab(tab, { push = true } = {}) {
  if (push && tab !== state.tab) pushRoute(tab);
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
  if (spot.closed) return { st, html: `<span class="status closed">Closed for ${esc(spot.closed.reason)}</span>` };
  if (st.open === true) return { st, html: `<span class="status open">${esc(cap(openLabel(st, now)))}</span>` };
  if (st.open === false) return { st, html: `<span class="status closed">Closed${st.opensAt ? ", opens " + esc(fmtTime(st.opensAt, now)) : ""}</span>` };
  return { st, html: `<span class="status">Hours unknown</span>` };
}
// Status first, then short plain-text facts separated by dots.
const SEP = `<span class="sep" aria-hidden="true">·</span>`;
const factLine = (parts) => parts.filter(Boolean).join(SEP);

function renderNow() {
  const now = nowDate();
  const banner = [];
  if (bannerMsg) banner.push(bannerMsg);
  if (isClosureDay(isoDate(now), state.calendar)) banner.push("The university is closed today, so most spots are shut.");
  if (state.hours.error && !state.hours.fetchedAt) banner.push("Library hours couldn’t load, so libraries are left out of suggestions for now.");
  $("#now-banner").innerHTML = banner.map((m) => `<p class="banner">${esc(m)}</p>`).join("");
  updatePrompt();
  $("#here").innerHTML = promptHtml();

  const ranked = rankSpots(
    state.spots.filter((s) => !state.skipped.has(s.id) && !state.hidden.has(s.id)),
    { profile: profile(), from: fromPoint(), now, needMinutes: state.need, prefs: state.prefs, busy: state.busy },
    ctx(), state.buildings,
  );
  const top = ranked.slice(0, 3);
  // Animate the picks in only when they change, not on the once-a-minute refresh.
  const key = top.map((r) => r.spot.id).join() || "none";
  $("#picks").classList.toggle("still", key === state.picksKey);
  state.picksKey = key;
  $("#picks").innerHTML = top.length
    ? top.map((r, i) => pickCard(r, now, i === 0)).join("")
    : `<li class="empty">Nothing we can confirm is open for that long right now. Try less time, fewer preferences, or Explore for spots with unpublished hours.</li>`;
  $("#next").hidden = ranked.length <= 1;
  $("#reset-skips").hidden = state.skipped.size === 0;

  // Members-only rooms with unpublished hours: the app's niche, shown honestly.
  const from = fromPoint();
  const also = state.spots
    .filter((s) => s.walkIn && s.hours.type === "unknown" && access(s, profile()).mine && !state.hidden.has(s.id))
    .map((s) => ({ s, walk: walkMinutes(from, state.buildings[s.building]) }))
    .filter((x) => x.walk != null && x.walk <= 15)
    .sort((a, b) => a.walk - b.walk)
    .slice(0, 4);
  $("#also").hidden = also.length === 0;
  $("#also-list").innerHTML = also
    .map(({ s, walk }) => `<li><a href="#" data-open="${s.id}">${esc(s.name)}</a> <span class="meta">${SEP}${walk} min${SEP}${esc(s.who.map(ruleLabel).join(" or "))}</span></li>`)
    .join("");
}

// The best pick gets a big photo and its walk time in large type; the next two are compact rows.
function pickCard(r, now, hero) {
  const s = r.spot;
  const b = state.buildings[s.building];
  const facts = [`<span class="status open">${esc(cap(openLabel(r.status, now)))}</span>`, busyChip(r.busy)];
  for (const reason of r.reasons) {
    if (/min walk|^open /.test(reason)) continue;
    facts.push(reason === "only for your group" ? `<span class="mine">only for your group</span>` : esc(reason));
  }
  for (const w of r.warnings) facts.push(`<span class="warn-text">${esc(w)}</span>`);
  const ph = photoFor(s);
  const photo = ph
    ? `<button type="button" class="photo-btn" data-open="${s.id}" aria-label="Details for ${esc(s.name)}"><img class="photo" src="${esc(ph.src)}" alt="${esc(ph.alt)}" loading="lazy">${ph.outside ? `<span class="photo-label">Outside</span>` : ""}</button>`
    : hero ? "" : `<span class="no-photo" aria-hidden="true">${esc(b?.code || "")}</span>`;
  const walk = `<p class="walk"><b>${r.walk ?? "?"}</b><span>${hero ? "min walk" : "min"}</span></p>`;
  const actions = `<div class="text-actions">
      ${b ? `<a href="${directionsUrl(b)}" target="_blank" rel="noopener" data-dir="${s.id}">Directions</a>` : ""}
      <button type="button" data-open="${s.id}">Details</button>
      <button type="button" data-save="${s.id}" aria-pressed="${state.saved.has(s.id)}">${state.saved.has(s.id) ? "Saved" : "Save"}</button>
    </div>`;
  const title = `<h3>${esc(s.name)}</h3><p class="where">${esc(b ? b.name : s.where)}</p>`;
  if (hero) {
    return `<li class="pick hero" data-id="${s.id}">
    ${photo}
    <div class="head"><div><p class="eyebrow-best">Best pick right now</p>${title}</div>${walk}</div>
    <p class="line">${factLine(facts)}</p>
    ${actions}
  </li>`;
  }
  return `<li class="pick compact" data-id="${s.id}">
    ${photo}
    <div class="body">${title}<p class="line">${factLine(facts)}</p>${actions}</div>
    ${walk}
  </li>`;
}

const directionsUrl = (b) => `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lon}&travelmode=walking`;

// Inside photos of the spot when we have them (the first goes on cards); otherwise the outside of its building, labelled "Outside".
function photosFor(s) {
  const P = state.photos;
  const shape = (p, outside) => ({ ...p, src: `photos/${p.file}`, alt: p.alt || s.name, outside });
  const inside = [].concat(P.spots?.[s.id] ?? []).map((id) => P.photos?.[id]).filter(Boolean);
  if (inside.length) return inside.map((p) => shape(p, false));
  const p = P.photos?.[P.buildings?.[s.building]];
  return p ? [shape(p, true)] : [];
}
const photoFor = (s) => photosFor(s)[0] || null;
function photoCredit(p) {
  // Photos taken for the app (headcount walks) aren't from Commons, so they don't get the "via" line.
  if (p.own) return `Photo: ${esc(p.artist)}, taken for Study Spots`;
  return `Photo: <a href="${esc(p.page)}" target="_blank" rel="noopener">${esc(p.artist)}</a>, ` +
    (p.licenseUrl ? `<a href="${esc(p.licenseUrl)}" target="_blank" rel="noopener">${esc(p.license)}</a>` : esc(p.license)) +
    `, via ${esc(p.via || "Wikimedia Commons")}` + (p.changes ? ` (${esc(p.changes)})` : "");
}

function usableSpots() {
  return state.spots.filter((s) => access(s, profile()).ok);
}

function listRow(s, now, from) {
  const { html } = statusTag(s, now);
  const b = state.buildings[s.building];
  const walk = b && from ? walkMinutes(from, b) : null;
  const acc = access(s, profile());
  const facts = [html, busyChip(busyStatus(s.id, state.busy, now))];
  if (state.hidden.has(s.id)) facts.push(`<span class="hint">Hidden by you</span>`);
  if (acc.mine) facts.push(`<span class="mine">Yours</span>`);
  if (acc.unclear) facts.push(`<span class="warn-text">Access unclear</span>`);
  if (s.noise) facts.push(esc(s.noise));
  if (!s.walkIn) facts.push("Book or check first");
  const ph = photoFor(s);
  return `<li><button type="button" class="row-item" data-open="${s.id}">
    ${ph ? `<img class="thumb" src="${esc(ph.src)}" alt="" loading="lazy">` : `<span class="no-thumb" aria-hidden="true">${esc(b?.code || "")}</span>`}
    <span class="name">${esc(s.name)}</span>
    <span class="side">${walk != null ? walk + " min" : ""}</span>
    <span class="meta">${esc(b ? b.name : s.where)}</span>
    <span class="line">${factLine(facts)}</span>
  </button></li>`;
}

function renderExplore() {
  const now = nowDate();
  const from = fromPoint();
  const onlyOpen = $("#x-open").checked;
  const noise = $("#x-noise").value;
  const q = $("#x-q").value.trim().toLowerCase();
  const hiddenCount = usableSpots().filter((s) => state.hidden.has(s.id)).length;
  const rows = usableSpots()
    .filter((s) => state.showHidden || !state.hidden.has(s.id))
    .filter((s) => !noise || s.noise === noise)
    .filter((s) => !q || `${s.name} ${s.where} ${s.notes} ${state.buildings[s.building]?.name ?? ""}`.toLowerCase().includes(q))
    .map((s) => ({ s, st: openStatus(s, now, ctx()), walk: s.building ? walkMinutes(from, state.buildings[s.building]) : 999 }))
    .filter((x) => !onlyOpen || x.st.open === true)
    .sort((a, b) => a.walk - b.walk || a.s.name.localeCompare(b.s.name));
  $("#x-count").innerHTML = `${rows.length} spot${rows.length === 1 ? "" : "s"} you can use · closest first from ${esc(fromLabel())}` +
    (hiddenCount ? ` · <button type="button" class="btn link inline" data-show-hidden>${state.showHidden ? "Leave out" : "Show"} ${hiddenCount} hidden</button>` : "");
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

function toggleHide(id) {
  const hiding = !state.hidden.has(id);
  if (hiding) state.hidden.add(id); else state.hidden.delete(id);
  store.set("hidden-v1", [...state.hidden]);
  state.skipped.delete(id);
  render();
  if ($("#sheet").open) openSheet(id);
}

function toggleSave(id) {
  if (state.saved.has(id)) state.saved.delete(id); else state.saved.add(id);
  store.set("saved-v1", [...state.saved]);
  render();
  if ($("#sheet").open) openSheet(id);
}

// ---------- spot detail ----------
function openSheet(id, { push = true } = {}) {
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
  const hoursNote = s.closed
    ? esc(s.closed.text)
    : s.hours.type === "libcal"
    ? "From U of T Libraries’ live hours."
    : s.hours.type === "weekly"
      ? `From ${esc(s.hours.asOf)}.${s.hours.dated ? " This source is old, so check on site." : ""}`
      : `Hours aren’t published${s.hoursText && !/^Not published/.test(s.hoursText) ? `: ${esc(s.hoursText)}` : ""}.`;
  const facts = [
    ["Who can use it", esc(s.who.map(ruleLabel).join(" or ")) + (s.whoBasis === "assumed" ? " (assumed from the college’s wording)" : "") + (acc.mine ? ` <span class="mine">(yours)</span>` : "")],
    ["Door", s.cardDoor ? "TCard or fob needed to get in" : "No card reader known"],
    ["Noise", s.noise ? esc(s.noise) + (s.noiseOfficial ? " (official library label)" : "") : "Not stated"],
    ["Outlets", s.outlets === "yes" ? "Yes" : s.outlets === "limited" ? "Very limited" : "Unknown"],
    ["Food", s.food === "yes" ? "Allowed" : s.food === "no" ? "Not allowed" : s.food === "drinks" ? "Covered drinks only" : "Unknown"],
    ["Where", esc(s.where) + (b ? `<br><span class="hint">${esc(b.address)}${b.approx || s.locationApprox ? " · map pin is approximate" : ""}</span>` : "")],
  ];
  const phs = photosFor(s);
  const walk = b ? walkMinutes(fromPoint(), b) : null;
  // Several photos scroll sideways; the arrows are for mouse users, swiping works on phones.
  const gallery = !phs.length ? "" : `<div class="sheet-gallery">
    <div class="sheet-photos" tabindex="0" aria-label="Photos of ${esc(s.name)}">${phs.map((ph, i) => `<figure class="sheet-photo">
      <div class="frame"><img src="${esc(ph.src)}" alt="${esc(ph.alt)}"${i ? ' loading="lazy"' : ""}>${phs.length > 1 ? `<span class="photo-count">${i + 1} of ${phs.length}${i === 0 ? " · swipe" : ""}</span>` : ""}</div>
      <figcaption>${ph.caption ? `${esc(ph.caption)}. ` : ""}${photoCredit(ph)}</figcaption></figure>`).join("")}</div>
    ${phs.length > 1 ? `<button type="button" class="gallery-step prev" data-step="-1" aria-label="Previous photo">‹</button><button type="button" class="gallery-step next" data-step="1" aria-label="Next photo">›</button>` : ""}
  </div>`;
  $("#sheet-body").innerHTML = `<div class="sheet">
    ${gallery}
    <h2 id="sheet-h">${esc(s.name)}</h2>
    <p class="line">${factLine([tag, walk != null ? `${walk} min walk from ${esc(fromLabel())}` : "", s.status === "scout" ? `<span class="warn-text">Not yet checked on site</span>` : ""])}</p>
    <p>${esc(s.notes)}</p>
    <div class="text-actions">
      ${b ? `<a class="btn small" href="${directionsUrl(b)}" target="_blank" rel="noopener" data-dir="${s.id}">Directions</a>` : ""}
      ${s.bookUrl ? `<a href="${esc(s.bookUrl)}" target="_blank" rel="noopener">Book a room</a>` : ""}
      <button type="button" data-save="${s.id}" aria-pressed="${state.saved.has(s.id)}">${state.saved.has(s.id) ? "Saved" : "Save"}</button>
      <button type="button" data-hide="${s.id}">${state.hidden.has(s.id) ? "Unhide" : "Hide"}</button>
    </div>
    ${state.hidden.has(s.id) ? `<p class="hint">You’ve hidden this spot, so it’s never suggested and Explore leaves it out. Unhide it any time here or under You.</p>` : ""}
    ${busySection(s, now)}
    <h4>Hours</h4>
    <table class="hours-table"><tbody>${days.join("")}</tbody></table>
    <p class="hint">${hoursNote}</p>
    <h4>Details</h4>
    <dl class="kv">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    ${photoSection(s)}
    <h4>Sources</h4>
    <ul class="sources">${s.sources.map((x) => `<li><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a></li>`).join("") || "<li>No official page found</li>"}</ul>
  </div>`;
  if (!$("#sheet").open) {
    if (push) pushRoute(state.tab, id);
    store.set("recent-spot-v1", { id, at: Date.now() });
    $("#sheet").showModal();
  }
}

// How busy: the latest report, the usual pattern through today, and (if you're there, or doing headcount walks)
// buttons to report. Hidden entirely when there's no backend.
function busySection(s, now) {
  if (!crowdEnabled()) return "";
  const b = busyStatus(s.id, state.busy, now);
  const usual = busyStatus(s.id, { typical: state.busy?.typical }, now);
  const live = b?.kind === "live"
    ? `<p class="line">${busyChip(b)}${b.n > 1 ? `${SEP}<span class="hint">${b.n} reports</span>` : ""}</p>`
    : `<p class="hint">No reports in the last 45 minutes.</p>`;
  const day = typicalDay(s.id, state.busy, now);
  const known = day.filter((h) => h.level);
  const words = { 1: "quiet", 2: "busy", 3: "full" };
  const hourName = (h) => clock(h * 60).replace(":00", "");
  const pattern = known.length >= 3
    ? `<div class="busy-bars" role="img" aria-label="Usually, ${known.map((h) => `${hourName(h.hour)} ${words[h.level]}`).join(", ")}">${day.map((h) =>
        `<span class="bar lv${h.level || 0}${h.hour === now.getHours() ? " now" : ""}" title="${hourName(h.hour)}: ${h.level ? words[h.level] : "not enough reports"}"></span>`).join("")}</div>
       <div class="busy-axis" aria-hidden="true"><span>8am</span><span>12pm</span><span>4pm</span><span>8pm</span></div>`
    : `<p class="hint">Not enough reports yet to show when it’s usually busy.</p>`;
  const canReport = state.contributor || isHere(s);
  const reportRow = canReport ? `<div class="report-row">
      <p class="label">How busy is it now?</p>
      <div class="levels">${[1, 2, 3].map((l) => `<button type="button" class="lv${l}" data-report-level="${l}" data-spot="${s.id}">${BUSY_LEVELS[l]}</button>`).join("")}</div>
      ${state.contributor ? `<label class="field people"><span>People you counted (optional)</span><input type="number" id="report-people" min="0" max="2000" inputmode="numeric"></label>` : ""}
      <p class="hint" id="report-thanks" hidden>Thanks! Everyone sees that for the next 45 minutes.</p>
    </div>` : "";
  return `<h4>How busy</h4>${live}${usual ? `<p class="hint">${esc(busyLabel(usual))}, from ${usual.n} reports at this hour.</p>` : ""}${pattern}${reportRow}`;
}

// Add a photo: offered when a spot has no inside photo and you're there, or always in headcount-walk mode.
function photoSection(s) {
  if (!crowdEnabled()) return "";
  const hasInside = photosFor(s).some((p) => !p.outside);
  const here = isHere(s);
  if (!state.contributor && !(here && !hasInside)) return "";
  if (here && !hasInside) {
    const log = store.get("photo-prompt-v1", { day: "", ids: [] });
    const today = isoDate(nowDate());
    if (log.day !== today) Object.assign(log, { day: today, ids: [] });
    if (!log.ids.includes(s.id)) { log.ids.push(s.id); store.set("photo-prompt-v1", log); sendEvent("photo_prompt_shown", s.id); }
  }
  const lead = hasInside ? "Add another photo of this spot." : here ? "No inside photo yet, and you’re here. Could you add one?" : "No inside photo yet.";
  return `<h4>Photos</h4>
    <form class="photo-form" data-photo-form="${s.id}">
      <p class="hint">${lead} It’s shrunk and stripped of location data on your phone, and shows up after a quick review.</p>
      <label class="btn small ghost file">Choose or take a photo<input type="file" name="file" accept="image/*" hidden></label>
      <img class="photo-preview" alt="The photo you picked" hidden>
      <label class="field"><span>What does it show?</span><input name="caption" maxlength="140" minlength="3" required placeholder="e.g. Tables by the windows, 2nd floor"></label>
      <label class="field"><span>Name for the photo credit (optional)</span><input name="credit" maxlength="60" value="${esc(state.credit)}" autocomplete="nickname"></label>
      <label class="check"><input type="checkbox" required><span>I took this photo, and Study Spots may use it under <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a></span></label>
      <label class="check"><input type="checkbox" required><span>No one’s face can be recognized in it</span></label>
      <button class="btn small" type="submit">Send for review</button>
      <p class="hint photo-status" aria-live="polite"></p>
    </form>`;
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
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    state.profile = save ? readProfile("ob") : { fac: "other", prog: "", col: "", res: "none", csc: false };
    store.set("profile-v1", state.profile);
    if (dlg.open) dlg.close();
    render();
    if (pendingSpot) { openSheet(pendingSpot); pendingSpot = null; }
    // Then ask for location, so the first list is the closest spots to where they are.
    if (state.near === null || state.near === "gps") startLocation({ userAsked: false });
  };
  // Handled on the buttons and Esc directly; the dialog's own close event can arrive late (or, in a background tab, not at all).
  $("#onboard-form").addEventListener("submit", (e) => { e.preventDefault(); finish(e.submitter?.value === "save"); });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(false); });
  dlg.addEventListener("close", () => finish(dlg.returnValue === "save"), { once: true });
  dlg.showModal();
}

function renderHidden() {
  const list = state.spots.filter((s) => state.hidden.has(s.id));
  $("#hidden-spots").hidden = list.length === 0;
  $("#hidden-list").innerHTML = list.map((s) => `<li><a href="#" data-open="${s.id}">${esc(s.name)}</a> <button type="button" class="btn link" data-hide="${s.id}">Unhide</button></li>`).join("");
}

function renderYou() {
  renderHidden();
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
  // Headcount walks: report and add photos for any spot, wherever you are.
  $("#contribute").hidden = !crowdEnabled();
  $("#contributor").checked = state.contributor;
  $("#contributor").addEventListener("change", (e) => {
    state.contributor = e.target.checked;
    store.set("contributor-v1", state.contributor);
  });
}

// Installable app + offline fallback. Skipped inside the Android wrapper's local files, where it isn't needed.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* the app still works without it */ });
}

// The Android wrapper adds "StudySpotsAndroid/<version>" to its user agent; show it so an old install is easy to spot.
const appVersion = navigator.userAgent.match(/StudySpotsAndroid\/([\d.]+)/);
if (appVersion) {
  $("#app-version").textContent = `Android app ${appVersion[1]}`;
  $("#app-version").hidden = false;
}

boot().catch((e) => {
  $("#picks").innerHTML = `<li class="empty">Something went wrong loading the spot data (${esc(e.message)}). Reload to try again.</li>`;
});
