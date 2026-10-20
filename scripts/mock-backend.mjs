// A local stand-in for the Apps Script backend, running the real backend/Code.gs (via backend/harness.mjs).
//   node scripts/mock-backend.mjs [port]          then open http://localhost:8080/?api=http://localhost:8787
// Extra, mock only: GET /approve?id=<photo id or "all"> approves submitted photos, as you would in the sheet.
import { createServer } from "node:http";
import { loadBackend } from "../backend/harness.mjs";

const port = Number(process.argv[2] || 8787);
const b = loadBackend();

// --seed: three weeks of made-up reports for a few spots, plus some fresh ones, to see the UI with data.
if (process.argv.includes("--seed")) {
  const rows = b.sheet("Reports").rows;
  const spots = ["ecsl-quiet", "ecsl-main", "gerstein-rr", "robarts-floors", "kelly-3", "myhal-5", "bahen-3", "eng-engsci", "uc-lib"];
  const peak = (h) => (h >= 11 && h <= 16 ? 3 : h >= 9 && h <= 19 ? 2 : 1);
  for (let day = 1; day <= 21; day++) {
    for (const spot of spots) {
      for (let h = 8; h <= 22; h += 1) {
        if ((day + h + spot.length) % 3) continue; // sparse, like real reports
        const t = new Date(); t.setDate(t.getDate() - day); t.setHours(h, 15, 0, 0);
        const lvl = Math.min(3, Math.max(1, peak(h) + ((day + spot.length) % 3) - 1));
        rows.push([t, spot, lvl, "prompt", "seed-device-" + (day % 5), ""]);
      }
    }
  }
  const ago = (m) => new Date(Date.now() - m * 60000);
  rows.push([ago(12), "gerstein-rr", 3, "prompt", "seed-device-a", ""]);
  rows.push([ago(5), "ecsl-quiet", 2, "next-button", "seed-device-b", ""]);
  rows.push([ago(30), "robarts-floors", 1, "prompt", "seed-device-c", ""]);
  console.log("seeded", rows.length - 1, "reports");
}
const send = (res, obj) => {
  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (req.method === "GET" && url.pathname === "/approve") {
    const id = url.searchParams.get("id");
    const rows = b.sheet("Photos").rows.slice(1).filter((r) => r[6] === "pending" && (id === "all" || r[0] === id));
    rows.forEach((r) => { r[6] = "approved"; });
    return send(res, { ok: rows.length > 0, approved: rows.map((r) => r[0]) });
  }
  if (req.method === "GET") return send(res, b.get(Object.fromEntries(url.searchParams)));
  if (req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      try { send(res, b.post(JSON.parse(body))); } catch { send(res, { ok: false, error: "bad request" }); }
      console.log(new Date().toLocaleTimeString(), "POST", body.slice(0, 120));
    });
    return;
  }
  res.writeHead(405).end();
}).listen(port, () => console.log(`mock backend on http://localhost:${port}`));
