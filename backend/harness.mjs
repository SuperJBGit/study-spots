// Runs backend/Code.gs in Node with in-memory stand-ins for the Google services it uses, so the backend can be
// tested (test/backend.test.js) and run locally (scripts/mock-backend.mjs) without a Google account.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

export function loadBackend({ now = () => Date.now() } = {}) {
  const sheets = new Map();
  const files = new Map();
  const props = new Map();
  const cache = new Map();
  const logs = [];

  const range = (sheet, row, col) => {
    const chain = {
      setValues(values) {
        if (row) values.forEach((v, i) => { sheet.rows[row - 1 + i] = [...v]; });
        return chain;
      },
      setFontWeight: () => chain, setDataValidation: () => chain, setFormula: () => chain, setNumberFormat: () => chain,
    };
    return chain;
  };
  const makeSheet = (name) => {
    const sheet = {
      name, rows: [],
      getRange: (a, b) => range(sheet, typeof a === "number" ? a : 0, b),
      setFrozenRows() {}, clear() { if (name !== "Summary") sheet.rows = []; }, setColumnWidth() {},
      appendRow(r) { sheet.rows.push([...r]); },
      getDataRange: () => ({ getValues: () => sheet.rows.map((r) => [...r]) }),
    };
    return sheet;
  };
  const spreadsheet = {
    getId: () => "sheet-1", getUrl: () => "https://docs.google.com/spreadsheets/d/sheet-1",
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet(n) { const s = makeSheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()], deleteSheet(s) { sheets.delete(s.name); },
  };
  sheets.set("Sheet1", makeSheet("Sheet1"));

  const fmt = (d, tz, pattern) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(d).map((p) => [p.type, p.value]));
    if (pattern === "yyyy-MM-dd") return `${parts.year}-${parts.month}-${parts.day}`;
    if (pattern === "u H") return `${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1} ${Number(parts.hour)}`;
    throw new Error("pattern not stubbed: " + pattern);
  };

  const g = {
    SpreadsheetApp: {
      openById: () => spreadsheet, create: () => spreadsheet,
      newDataValidation: () => { const c = { requireValueInList: () => c, build: () => ({}) }; return c; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, v) }) },
    CacheService: {
      getScriptCache: () => ({
        get(k) { const e = cache.get(k); return e && e.until > now() ? e.v : null; },
        put(k, v, s) { cache.set(k, { v: String(v), until: now() + s * 1000 }); },
        remove(k) { cache.delete(k); },
      }),
    },
    Utilities: {
      formatDate: fmt,
      getUuid: () => randomUUID(),
      base64Decode: (s) => { if (!/^[A-Za-z0-9+/=\s]*$/.test(s)) throw new Error("bad base64"); return [...Buffer.from(s, "base64")].map((b) => (b > 127 ? b - 256 : b)); },
      base64Encode: (bytes) => Buffer.from(bytes.map((b) => b & 0xff)).toString("base64"),
      newBlob: (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes }),
    },
    DriveApp: {
      createFolder: () => ({ getId: () => "folder-1" }),
      getFolderById: () => ({ createFile(blob) { const id = "file-" + (files.size + 1); files.set(id, blob); return { getId: () => id }; } }),
      getFileById: (id) => ({ getBlob: () => files.get(id) }),
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    UrlFetchApp: { fetch: () => ({ getContentText: () => readFileSync(new URL("data/spots.json", root), "utf8") }) },
    ContentService: { createTextOutput: (s) => ({ text: s, setMimeType() { return this; } }), MimeType: { JSON: "json" } },
    Logger: { log: (s) => logs.push(s) },
    Date: class extends Date { constructor(...a) { super(...(a.length ? a : [now()])); } static now() { return now(); } },
  };
  const ctx = vm.createContext(g);
  vm.runInContext(readFileSync(new URL("backend/Code.gs", root), "utf8"), ctx, { filename: "Code.gs" });
  ctx.setup();

  const parse = (out) => JSON.parse(out.text);
  return {
    get: (params = {}) => parse(ctx.doGet({ parameter: params })),
    post: (body) => parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } })),
    sheet: (name) => sheets.get(name),
    clearCache: () => cache.clear(),
    logs,
  };
}
