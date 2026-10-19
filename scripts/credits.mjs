// Rebuilds photos/CREDITS.md from data/photos.json. Run after adding or changing a photo:
//   node scripts/credits.mjs
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const P = JSON.parse(readFileSync(new URL("data/photos.json", root), "utf8"));
const all = Object.values(P.photos);

const line = (p) => p.own
  ? `- \`${p.file}\` (${p.alt}): taken for this app by ${p.artist}, ${p.license.toLowerCase()}`
  : `- \`${p.file}\` (${p.alt}): [${p.title}](${p.page}) by ${p.artist}, ${p.license}` +
  (p.licenseUrl ? ` (${p.licenseUrl})` : "") +
  (p.via && p.via !== "Wikimedia Commons" ? `, via ${p.via}` : "") +
  (p.changes ? `; ${p.changes}` : "");
const nc = all.filter((p) => p.nonCommercial).map((p) => `\`${p.file}\``);

const md = [
  "# Photo credits",
  "",
  "Generated from `data/photos.json` by `scripts/credits.mjs`; edit the JSON, not this file. Each photo keeps its original licence, listed below. The only changes are resizing to fit 800 × 600 px, plus any crop noted on the line.",
  "",
  ...(nc.length ? [`**Non-commercial:** ${nc.join(", ")} are under non-commercial licences (CC BY-NC or BY-NC-SA). Remove them if the app ever makes money.`, ""] : []),
  "## Inside photos",
  "",
  ...all.filter((p) => p.kind === "spot").map(line),
  "",
  "## Outside photos (used only when a spot has no inside photo)",
  "",
  ...all.filter((p) => p.kind === "building").map(line),
  "",
];
writeFileSync(new URL("photos/CREDITS.md", root), md.join("\n"));
console.log(`CREDITS.md: ${all.length} photos (${nc.length} non-commercial)`);
