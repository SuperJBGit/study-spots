// One-time import: turns the spot table in the research sheet (study-spots.html)
// into data/spots.json. After this, edit data/spots.json directly.
//
// Usage: node scripts/import-research.mjs research/study-spots.html
import { readFileSync, writeFileSync } from "node:fs";

const src = readFileSync(process.argv[2] ?? "research/study-spots.html", "utf8");
const grab = (name, open, close) => {
  const start = src.indexOf(`var ${name} = ${open}`);
  if (start < 0) throw new Error(`no ${name} in research sheet`);
  let depth = 0;
  for (let i = start + `var ${name} = `.length; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) {
      return new Function(`return ${src.slice(start + `var ${name} = `.length, i + 1)};`)();
    }
  }
  throw new Error(`unterminated ${name}`);
};
const S = grab("S", "{", "}");
const R = grab("R", "[", "]");

// Which building each spot is in (keys of data/buildings.json).
const BUILDING = {
  "stcommons": "stcommons", "myhal-2": "myhal", "myhal-5": "myhal", "myhal-8": "myhal", "myhal-4": "myhal", "myhal-67": "myhal",
  "bahen-3": "bahen", "bahen-labs": "bahen", "bahen-cssu": "bahen", "eng-engsci": "bahen", "eng-ece-hall": "bahen", "math-lib": "bahen",
  "eng-ece": "sf", "sf-pit": "sf", "ecsl-main": "sf", "ecsl-quiet": "sf", "ecsl-rooms": "sf",
  "eng-chem": "wallberg", "eng-mse": "wallberg", "eng-civ": "galbraith", "eng-mech": "mining", "eng-min": "mining",
  "gerstein-rr": "gerstein", "gerstein-silent": "gerstein", "gerstein-morrison": "gerstein", "gerstein-wallace": "gerstein",
  "gerstein-lower": "gerstein", "gerstein-heritage": "gerstein", "gerstein-rooms": "gerstein",
  "uc-clark": "uc", "uc-lib": "uc", "uc-csc": "uc",
  "hh-lib": "hartHouse", "hh-reading": "hartHouse", "hh-map": "hartHouse", "hh-arbor": "hartHouse",
  "donnelly": "donnelly", "md-msb": "msb", "pharm": "pharmacy", "sric": "sric", "chem-lib": "lashMiller",
  "phys-lib": "mcLennan", "knox": "knox", "empty-rooms": null,
  "ssc": "sidSmith", "art-lib": "sidSmith", "rotman-lib": "rotman", "wdw": "woodsworth", "innis-events": "innisRes",
  "newman": "irhr", "nc-ivey": "wilsonHall", "nc-wilson": "wilsonHall", "nc-45": "nc45", "nc-multi": "nc45",
  "earth-lib": "earthSci", "arch-lib": "daniels",
  "robarts-common": "robartsCommon", "robarts-floors": "robarts", "pjrc": "robarts", "robarts-rooms": "robarts",
  "oise-ground": "oise", "oise-quiet": "oise", "oise-collab": "oise", "oise-nexus": "oise",
  "innis-cinema": "innis", "innis-carrels": "innis", "innis-commuter": "innis", "innis-roof": "innis",
  "trinity-graham": "graham", "trinity-buttery": "larkin", "trinity-jcr": "trinity", "trinity-hildas": "stHildas",
  "music-lib": "edJohnson", "pratt": "pratt", "crrs": "pratt", "emmanuel": "emmanuel", "goldring": "goldring",
  "vic-commuter": "vic", "vic-rooms": "vic", "kelly-g": "kelly", "kelly-2": "kelly", "kelly-3": "kelly",
  "smc-commuter": "brennan", "smc-canada": "brennan", "smc-brennan": "brennan",
};
// Spots whose exact room location isn't published: pinned to the building, flagged.
const LOCATION_APPROX = new Set(["uc-csc", "vic-commuter", "smc-canada"]);

// LibCal location ids (api_hours_grid.php, iid 478), checked Oct 12, 2026.
const LIBCAL = {
  "robarts-floors": 8158, "robarts-rooms": 8158, "pjrc": 8413, "robarts-common": 8315,
  "gerstein-rr": 8321, "gerstein-silent": 8321, "gerstein-morrison": 8321, "gerstein-wallace": 8321,
  "gerstein-lower": 8321, "gerstein-heritage": 8321, "gerstein-rooms": 8321,
  "ecsl-main": 8400, "ecsl-quiet": 8400, "ecsl-rooms": 8400,
  "oise-ground": 8328, "oise-quiet": 8328, "oise-collab": 8328,
  "kelly-g": 8454, "kelly-2": 8454, "kelly-3": 8454, "pratt": 8438, "crrs": 8437, "emmanuel": 8416,
  "trinity-graham": 8347, "uc-lib": 8435, "nc-ivey": 8442, "chem-lib": 8322, "phys-lib": 8323,
  "math-lib": 8325, "earth-lib": 8324, "music-lib": 8344, "arch-lib": 8163, "rotman-lib": 8362,
  "newman": 8351, "knox": 8441, "art-lib": 8363,
};

// Fixed weekly hours for non-library spots that have a published source.
const wk = (weekday, sat, sun = sat) => ({
  mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat, sun,
});
const MYHAL = { week: wk([["07:00", "22:00"]], [["08:00", "20:00"]]), asOf: "Myhal access protocol, Oct 2018", dated: true };
const WEEKLY = {
  "myhal-2": MYHAL, "myhal-5": MYHAL, "myhal-4": MYHAL, "myhal-8": MYHAL, "myhal-67": MYHAL,
  "ssc": { week: { ...wk([["10:00", "19:30"]], []), fri: [["10:00", "17:00"]] }, asOf: "Sidney Smith Commons page, 2026" },
  "hh-arbor": { week: wk([["08:30", "19:00"]], [["09:00", "15:00"]]), asOf: "Facilities & Services, Jan 2026" },
  "hh-lib": { week: wk([["07:00", "23:00"]], [["09:00", "18:00"]]), asOf: "Hart House 'open' page (undated, looks old)", dated: true },
  "hh-reading": { week: wk([["07:00", "23:00"]], [["09:00", "18:00"]]), asOf: "Hart House 'open' page (undated, looks old)", dated: true },
  "hh-map": { week: wk([["07:00", "23:00"]], [["09:00", "18:00"]]), asOf: "Hart House 'open' page (undated, looks old)", dated: true },
  "vic-rooms": { week: wk([["09:00", "17:00"]], []), asOf: "Vic study spaces page" },
  "bahen-labs": { week: wk([["00:00", "24:00"]], [["00:00", "24:00"]]), asOf: "CS Teaching Labs page (in term)" },
};

const OUTLETS_YES = new Set([
  "ecsl-main", "ecsl-quiet", "robarts-floors", "robarts-common", "gerstein-rr", "gerstein-silent",
  "gerstein-morrison", "gerstein-wallace", "gerstein-lower", "gerstein-heritage", "oise-ground",
  "oise-quiet", "oise-collab", "chem-lib", "music-lib", "emmanuel", "nc-wilson", "hh-lib", "bahen-labs",
]);
const OUTLETS_LIMITED = new Set(["knox"]);
const FOOD = {
  "robarts-common": "yes", "ecsl-main": "yes", "kelly-g": "yes", "kelly-2": "yes", "kelly-3": "yes",
  "hh-arbor": "yes", "myhal-2": "yes", "sf-pit": "yes", "stcommons": "yes", "trinity-buttery": "yes",
  "ecsl-quiet": "no", "gerstein-silent": "no", "oise-collab": "drinks", "empty-rooms": "no",
};
const BOOK = {
  "robarts-rooms": "https://libcal.library.utoronto.ca/r/search/robarts",
  "oise-collab": "https://libcal.library.utoronto.ca/r/search/OISE",
  "gerstein-rooms": "https://library.utoronto.ca/spaces?library=Gerstein%20Science%20Information%20Centre",
  "ecsl-rooms": "https://library.utoronto.ca/spaces?library=Engineering%20%26%20Computer%20Science%20Library",
};
const NOT_WALK_IN = new Set(["robarts-rooms", "gerstein-rooms", "ecsl-rooms", "empty-rooms", "nc-multi"]);

const spots = R.map((r) => {
  const [id, zone, name, where, type, noise, noiseOfficial, who, whoBasis, cardDoor, hoursText, notes, status, srcKeys] = r;
  if (!(id in BUILDING)) throw new Error(`no building for ${id}`);
  let hours;
  if (LIBCAL[id]) hours = { type: "libcal", lid: LIBCAL[id] };
  else if (WEEKLY[id]) hours = { type: "weekly", ...WEEKLY[id] };
  else hours = { type: "unknown" };
  return {
    id, name, where, zone, type,
    building: BUILDING[id],
    locationApprox: LOCATION_APPROX.has(id) || undefined,
    noise: noise === "—" ? null : noise,
    noiseOfficial,
    who, whoBasis, cardDoor,
    walkIn: !NOT_WALK_IN.has(id),
    hours,
    hoursText,
    outlets: OUTLETS_YES.has(id) ? "yes" : OUTLETS_LIMITED.has(id) ? "limited" : null,
    food: FOOD[id] ?? null,
    bookUrl: BOOK[id],
    notes,
    status,
    sources: srcKeys.map((k) => ({ title: S[k][0], url: S[k][1] })),
  };
});

writeFileSync(
  new URL("../data/spots.json", import.meta.url),
  JSON.stringify({ _source: "Imported from the research sheet on " + new Date().toISOString().slice(0, 10) + ". Edit this file directly from now on.", spots }, null, 1) + "\n",
);
console.log(`wrote ${spots.length} spots`);
