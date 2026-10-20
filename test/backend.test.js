// The Apps Script backend, run in Node through backend/harness.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBackend } from "../backend/harness.mjs";

const DEVICE = "0f8e2b1c-aaaa-4bbb-8ccc-123456789abc";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]).toString("base64");

test("setup makes the tabs, and reports are checked before they're stored", () => {
  const b = loadBackend();
  for (const t of ["Reports", "Events", "Photos", "Summary"]) assert.ok(b.sheet(t), t);
  assert.equal(b.sheet("Sheet1"), undefined);
  assert.equal(b.post({ type: "report", device: "x", spot: "kelly-3", level: 2, source: "prompt" }).error, "bad device");
  assert.equal(b.post({ type: "report", device: DEVICE, spot: "made-up-spot", level: 2, source: "prompt" }).error, "unknown spot");
  assert.equal(b.post({ type: "report", device: DEVICE, spot: "kelly-3", level: 7, source: "prompt" }).error, "bad level");
  assert.equal(b.post({ type: "report", device: DEVICE, spot: "kelly-3", level: 2, source: "spam" }).error, "bad source");
  assert.deepEqual(b.post({ type: "report", device: DEVICE, spot: "kelly-3", level: 2, source: "prompt" }), { ok: true });
  // Same phone, same spot, within 15 minutes: accepted but not stored again
  assert.equal(b.post({ type: "report", device: DEVICE, spot: "kelly-3", level: 3, source: "prompt" }).duplicate, true);
  assert.equal(b.sheet("Reports").rows.length, 2); // header + one report
  assert.equal(b.post({ type: "event", device: DEVICE, event: "prompt_shown", spot: "kelly-3" }).ok, true);
  assert.equal(b.post({ type: "event", device: DEVICE, event: "hack" }).error, "bad event");
});

test("busy: latest report counts as live for 45 minutes; patterns group by Toronto weekday/weekend and hour", () => {
  let clock = Date.parse("2026-10-21T18:10:00Z"); // Wed 2:10pm in Toronto
  const b = loadBackend({ now: () => clock });
  const rows = b.sheet("Reports").rows;
  const add = (iso, spot, level) => rows.push([new Date(iso), spot, level, "prompt", DEVICE, ""]);
  add("2026-10-21T17:40:00Z", "gerstein-rr", 2); // 30 min ago
  add("2026-10-21T18:00:00Z", "gerstein-rr", 3); // 10 min ago: the live one
  add("2026-10-21T16:00:00Z", "kelly-3", 1);     // 2 h ago: too old to be live
  add("2026-10-14T18:20:00Z", "gerstein-rr", 3); // last Wednesday, 2pm
  add("2026-10-17T18:20:00Z", "gerstein-rr", 1); // a Saturday, 2pm
  const busy = b.get({ action: "busy" });
  assert.deepEqual(busy.live["gerstein-rr"], { level: 3, at: "2026-10-21T18:00:00.000Z", n: 2 });
  assert.equal(busy.live["kelly-3"], undefined);
  assert.deepEqual(busy.typical["gerstein-rr"].wd14, { avg: 3, n: 2, days: 2 }); // 2:00pm today and 2:20pm last week
  assert.deepEqual(busy.typical["gerstein-rr"].wd13, { avg: 2, n: 1, days: 1 }); // 17:40 UTC is 1:40pm in Toronto
  assert.deepEqual(busy.typical["gerstein-rr"].we14, { avg: 1, n: 1, days: 1 });
  assert.deepEqual(busy.typical["kelly-3"].wd12, { avg: 1, n: 1, days: 1 });
  // An hour later the live report has expired (after the 60 s cache)
  clock += 60 * 60000;
  b.clearCache();
  assert.equal(b.get({ action: "busy" }).live["gerstein-rr"], undefined);
});

test("photos wait for review, and only approved ones come back out, without the uploader's device", () => {
  const b = loadBackend();
  const base = { type: "photo", device: DEVICE, spot: "eng-engsci", caption: "Lounge by the windows", credit: "Jo", license: "CC BY 4.0", consent: true };
  assert.equal(b.post({ ...base, data: Buffer.alloc(2000, 1).toString("base64") }).error, "not a JPEG");
  assert.equal(b.post({ ...base, data: JPEG, consent: false }).error, "licence not accepted");
  assert.equal(b.post({ ...base, data: JPEG, caption: "x" }).error, "caption must be 3 to 140 characters");
  const sent = b.post({ ...base, data: JPEG });
  assert.equal(sent.ok, true);
  assert.deepEqual(b.get({ action: "photos" }).photos, []);
  assert.equal(b.get({ action: "photo", id: sent.id }).ok, false);
  const row = b.sheet("Photos").rows.find((r) => r[0] === sent.id);
  assert.equal(row[6], "pending");
  row[6] = "approved"; // what you do in the sheet
  const list = b.get({ action: "photos" }).photos;
  assert.equal(list.length, 1);
  assert.deepEqual(Object.keys(list[0]).sort(), ["caption", "credit", "id", "license", "spot", "time"]);
  assert.equal(b.get({ action: "photo", id: sent.id }).data, JPEG);
  // Five photos per phone per six hours
  for (let i = 0; i < 4; i++) assert.equal(b.post({ ...base, data: JPEG }).ok, true);
  assert.match(b.post({ ...base, data: JPEG }).error, /limit/);
});
