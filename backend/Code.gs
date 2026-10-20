/**
 * Study Spots backend: busyness reports, usage events and photo submissions, kept in a Google Sheet you own.
 *
 * Set up once (README, "Crowd data"): paste this file into a new Apps Script project, run setup(),
 * then Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone. Put the /exec URL in src/config.js.
 *
 * Nothing here is secret. The app is public and anyone can call these URLs, so every input is checked and
 * rate-limited, no location is ever received, photos wait in a private Drive folder until you approve them in
 * the sheet, and only approved photos are ever served back.
 */

const TZ = "America/Toronto";
const SITE = "https://superjbgit.github.io/study-spots/";
const LIVE_MINUTES = 45;      // a report counts as "now" for this long
const HISTORY_DAYS = 56;      // usual patterns use the last 8 weeks
const LEVELS = [1, 2, 3];     // plenty of seats, filling up, full
const SOURCES = ["prompt", "next-button", "sheet", "contributor"];
const EVENTS = ["prompt_shown", "prompt_answered", "prompt_dismissed", "photo_prompt_shown", "photo_sent"];
const LICENSE = "CC BY 4.0";
const MAX_PHOTO_CHARS = 2000000; // base64, about 1.5 MB; the app sends about 150 KB

const TABS = {
  Reports: ["time", "spot", "level", "source", "device", "people"],
  Events: ["time", "type", "spot", "device", "detail"],
  Photos: ["id", "time", "spot", "caption", "credit", "license", "status", "fileId", "device"],
};

// ---------- setup ----------

function setup() {
  const props = PropertiesService.getScriptProperties();
  const sheetId = props.getProperty("SHEET_ID");
  const ss = sheetId ? SpreadsheetApp.openById(sheetId) : SpreadsheetApp.create("Study Spots data");
  props.setProperty("SHEET_ID", ss.getId());

  Object.keys(TABS).forEach(function (name) {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight("bold");
    sh.setFrozenRows(1);
  });
  ss.getSheetByName("Photos").getRange("G2:G").setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["pending", "approved", "rejected"], true).build());

  // The two-week test's numbers, kept live by formulas.
  const sum = ss.getSheetByName("Summary") || ss.insertSheet("Summary", 0);
  sum.clear();
  sum.getRange("A1:C12").setValues([
    ["Measure", "Value", "Target"],
    ["Questions shown", '=COUNTIF(Events!B:B,"prompt_shown")', ""],
    ["Questions answered", '=COUNTIF(Events!B:B,"prompt_answered")', ""],
    ["Answer rate", '=IFERROR(B3/B2,"")', "at least 25%"],
    ["Questions dismissed", '=COUNTIF(Events!B:B,"prompt_dismissed")', ""],
    ["Reports, all time", '=MAX(0,COUNTA(Reports!A:A)-1)', ""],
    ["Reports, last 7 days", '=COUNTIF(Reports!A:A,">="&(NOW()-7))', ""],
    ["Phones reporting, last 7 days", '=IFERROR(COUNTUNIQUE(FILTER(Reports!E2:E,Reports!A2:A>=NOW()-7)),0)', ""],
    ["Full taps on \"next spot\"", '=COUNTIF(Reports!D:D,"next-button")', ""],
    ["Photos waiting for review", '=COUNTIF(Photos!G:G,"pending")', ""],
    ["", "", ""],
    ["Reports per spot, last 7 days (top 5 should get one most weekdays)", "", ""],
  ]);
  sum.getRange("A13").setFormula('=IFERROR(QUERY(FILTER(Reports!B2:B,Reports!A2:A>=NOW()-7),"select Col1, count(Col1) group by Col1 order by count(Col1) desc label count(Col1) \'\'",0),"No reports yet")');
  sum.getRange("A1:C1").setFontWeight("bold");
  sum.getRange("B4").setNumberFormat("0%");
  sum.setColumnWidth(1, 330);

  const first = ss.getSheetByName("Sheet1");
  if (first && ss.getSheets().length > 1) ss.deleteSheet(first);

  let folderId = props.getProperty("FOLDER_ID");
  if (!folderId) {
    folderId = DriveApp.createFolder("Study Spots photo submissions").getId();
    props.setProperty("FOLDER_ID", folderId);
  }
  Logger.log("Sheet: " + ss.getUrl());
  Logger.log("Photo submissions: https://drive.google.com/drive/folders/" + folderId);
}

// ---------- web endpoints ----------

function doGet(e) {
  const p = (e && e.parameter) || {};
  const action = p.action || "busy";
  if (action === "busy") return json_(busy_());
  if (action === "photos") return json_({ photos: approvedPhotos_().map(publicPhoto_) });
  if (action === "photo") {
    const photo = approvedPhotos_().filter(function (x) { return x.id === p.id; })[0];
    if (!photo) return json_({ ok: false, error: "not found" });
    const bytes = DriveApp.getFileById(photo.fileId).getBlob().getBytes();
    return json_({ ok: true, id: photo.id, data: Utilities.base64Encode(bytes) });
  }
  return json_({ ok: false, error: "unknown action" });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: "bad request" }); }
  const device = String(body.device || "");
  if (!/^[a-z0-9-]{8,40}$/i.test(device)) return json_({ ok: false, error: "bad device" });
  if (!allow_("all:" + device, 120, 3600)) return json_({ ok: false, error: "slow down" });
  if (body.type === "report") return json_(report_(body, device));
  if (body.type === "event") return json_(event_(body, device));
  if (body.type === "photo") return json_(photo_(body, device));
  return json_({ ok: false, error: "unknown type" });
}

// ---------- writes ----------

function report_(body, device) {
  const spot = String(body.spot || "");
  const level = Number(body.level);
  const source = String(body.source || "");
  if (!validSpot_(spot)) return { ok: false, error: "unknown spot" };
  if (LEVELS.indexOf(level) < 0) return { ok: false, error: "bad level" };
  if (SOURCES.indexOf(source) < 0) return { ok: false, error: "bad source" };
  let people = "";
  if (body.people !== undefined && body.people !== null && body.people !== "") {
    people = Math.round(Number(body.people));
    if (!(people >= 0 && people <= 2000)) return { ok: false, error: "bad count" };
  }
  // One report per phone per spot every 15 minutes, so one person can't swing the picture.
  if (!allow_("r:" + device + ":" + spot, 1, 900)) return { ok: true, duplicate: true };
  append_("Reports", [new Date(), spot, level, source, device, people]);
  CacheService.getScriptCache().remove("busy");
  return { ok: true };
}

function event_(body, device) {
  const type = String(body.event || "");
  if (EVENTS.indexOf(type) < 0) return { ok: false, error: "bad event" };
  const spot = body.spot ? String(body.spot) : "";
  if (spot && !validSpot_(spot)) return { ok: false, error: "unknown spot" };
  if (!allow_("e:" + device, 300, 21600)) return { ok: true, dropped: true };
  append_("Events", [new Date(), type, spot, device, String(body.detail || "").slice(0, 40)]);
  return { ok: true };
}

function photo_(body, device) {
  const spot = String(body.spot || "");
  const caption = String(body.caption || "").trim();
  const credit = String(body.credit || "").trim().slice(0, 60);
  const data = String(body.data || "");
  if (!validSpot_(spot)) return { ok: false, error: "unknown spot" };
  if (caption.length < 3 || caption.length > 140) return { ok: false, error: "caption must be 3 to 140 characters" };
  if (body.license !== LICENSE || body.consent !== true) return { ok: false, error: "licence not accepted" };
  if (!data || data.length > MAX_PHOTO_CHARS) return { ok: false, error: "photo too large" };
  let bytes;
  try { bytes = Utilities.base64Decode(data); } catch (err) { return { ok: false, error: "bad photo" }; }
  if (bytes.length < 1000 || (bytes[0] & 0xff) !== 0xff || (bytes[1] & 0xff) !== 0xd8) return { ok: false, error: "not a JPEG" };
  if (!allow_("p:" + device, 5, 21600)) return { ok: false, error: "That's the limit for now. Try again later." };
  const id = "crowd-" + Utilities.getUuid().slice(0, 8);
  const folder = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty("FOLDER_ID"));
  const file = folder.createFile(Utilities.newBlob(bytes, "image/jpeg", id + ".jpg"));
  append_("Photos", [id, new Date(), spot, caption, credit, LICENSE, "pending", file.getId(), device]);
  return { ok: true, id: id };
}

// ---------- reads ----------

// Live: the latest report per spot from the last 45 minutes. Typical: average level per spot and hour bucket
// (weekday or weekend × hour, Toronto time) over the last 8 weeks, with how many reports and distinct days.
function busy_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("busy");
  if (hit) return JSON.parse(hit);
  const rows = sheet_("Reports").getDataRange().getValues().slice(1);
  const now = Date.now();
  const live = {}, acc = {};
  rows.forEach(function (r) {
    const t = new Date(r[0]).getTime(), spot = String(r[1]), level = Number(r[2]);
    if (!t || !spot || LEVELS.indexOf(level) < 0) return;
    const ageMin = (now - t) / 60000;
    if (ageMin <= LIVE_MINUTES && ageMin >= -5) {
      const cur = live[spot];
      if (!cur || t >= Date.parse(cur.at)) live[spot] = { level: level, at: new Date(t).toISOString(), n: (cur ? cur.n : 0) + 1 };
      else cur.n += 1;
    }
    if (ageMin <= HISTORY_DAYS * 1440) {
      const d = new Date(t), key = bucket_(d), day = Utilities.formatDate(d, TZ, "yyyy-MM-dd");
      if (!acc[spot]) acc[spot] = {};
      if (!acc[spot][key]) acc[spot][key] = { sum: 0, n: 0, days: {} };
      acc[spot][key].sum += level;
      acc[spot][key].n += 1;
      acc[spot][key].days[day] = true;
    }
  });
  const typical = {};
  Object.keys(acc).forEach(function (spot) {
    typical[spot] = {};
    Object.keys(acc[spot]).forEach(function (key) {
      const b = acc[spot][key];
      typical[spot][key] = { avg: Math.round((b.sum / b.n) * 100) / 100, n: b.n, days: Object.keys(b.days).length };
    });
  });
  const out = { live: live, typical: typical, updated: new Date().toISOString() };
  cache.put("busy", JSON.stringify(out), 60);
  return out;
}

function bucket_(d) {
  const parts = Utilities.formatDate(d, TZ, "u H").split(" "); // u: 1 = Monday … 7 = Sunday
  return (parts[0] === "6" || parts[0] === "7" ? "we" : "wd") + Number(parts[1]);
}

function approvedPhotos_() {
  return sheet_("Photos").getDataRange().getValues().slice(1)
    .filter(function (r) { return r[6] === "approved" && r[7]; })
    .map(function (r) { return { id: r[0], time: new Date(r[1]).toISOString(), spot: r[2], caption: r[3], credit: r[4], license: r[5], fileId: r[7] }; });
}
function publicPhoto_(p) { return { id: p.id, time: p.time, spot: p.spot, caption: p.caption, credit: p.credit, license: p.license }; }

// ---------- helpers ----------

function sheet_(name) {
  return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty("SHEET_ID")).getSheetByName(name);
}

function append_(name, row) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { sheet_(name).appendRow(row); } finally { lock.releaseLock(); }
}

// Spot ids come from the live site's data, so made-up ids are refused. Cached for 6 hours.
function validSpot_(id) {
  if (!/^[a-z0-9-]{2,40}$/.test(id)) return false;
  const cache = CacheService.getScriptCache();
  let ids = cache.get("spot-ids");
  if (!ids) {
    const data = JSON.parse(UrlFetchApp.fetch(SITE + "data/spots.json").getContentText());
    ids = data.spots.map(function (s) { return s.id; }).join(",");
    cache.put("spot-ids", ids, 21600);
  }
  return ("," + ids + ",").indexOf("," + id + ",") >= 0;
}

// At most `limit` calls per key in `seconds`. Cache-based, so approximate, which is fine for this.
function allow_(key, limit, seconds) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key) || 0);
  if (n >= limit) return false;
  cache.put(key, String(n + 1), seconds);
  return true;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
