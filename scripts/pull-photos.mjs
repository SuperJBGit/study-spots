// Imports approved photo submissions into the app: downloads each approved photo it doesn't have yet, adds it
// after the spot's existing photos in data/photos.json, and rebuilds photos/CREDITS.md.
// Runs daily as a GitHub Action (.github/workflows/pull-photos.yml); you can also run it yourself:
//   node scripts/pull-photos.mjs                                   uses API_URL from src/config.js
//   API_URL=http://localhost:8787 node scripts/pull-photos.mjs     against scripts/mock-backend.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const api = process.env.API_URL || (read("src/config.js").match(/API_URL\s*=\s*"([^"]*)"/) || [])[1];
if (!api) {
  console.log("No backend configured (API_URL in src/config.js is empty), so there's nothing to import.");
  process.exit(0);
}

const P = JSON.parse(read("data/photos.json"));
const spotIds = new Set(JSON.parse(read("data/spots.json")).spots.map((s) => s.id));
const { photos = [] } = await fetch(`${api}?action=photos`).then((r) => r.json());

let added = 0;
for (const p of photos) {
  if (P.photos[p.id] || !/^crowd-[a-z0-9]+$/.test(p.id)) continue; // already imported, or not one of ours
  if (!spotIds.has(p.spot)) { console.log(`skip ${p.id}: spot ${p.spot} no longer exists`); continue; }
  const res = await fetch(`${api}?action=photo&id=${encodeURIComponent(p.id)}`).then((r) => r.json());
  const bytes = res.ok ? Buffer.from(res.data, "base64") : null;
  if (!bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8) { console.log(`skip ${p.id}: ${res.error || "not a JPEG"}`); continue; }
  const file = `${p.id}.jpg`;
  writeFileSync(new URL(`photos/${file}`, root), bytes);
  const month = new Date(p.time).toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "America/Toronto" });
  P.photos[p.id] = {
    file, kind: "spot", alt: p.caption, caption: `${p.caption} (${month})`,
    artist: p.credit || "a Study Spots user", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    page: `https://github.com/SuperJBGit/study-spots/blob/main/photos/${file}`, title: file, via: "Study Spots contributors",
  };
  P.spots[p.spot] = [...(P.spots[p.spot] || []), p.id];
  added++;
  console.log(`added ${p.id} to ${p.spot}: "${p.caption}"`);
}

if (added) {
  writeFileSync(new URL("data/photos.json", root), JSON.stringify(P, null, 1) + "\n");
  execFileSync(process.execPath, [fileURLToPath(new URL("scripts/credits.mjs", root))], { stdio: "inherit" });
}
console.log(added ? `${added} photo${added === 1 ? "" : "s"} imported.` : "No new approved photos.");
