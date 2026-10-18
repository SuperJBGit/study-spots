// Data update, Oct 18, 2026: building codes from U of T's official campus map,
// and hours found for spots that had none. Run once: node scripts/update-2026-10-18.mjs
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const write = (p, v) => writeFileSync(new URL(`../${p}`, import.meta.url), JSON.stringify(v, null, 1) + "\n");

// ---- buildings: official codes (map.utoronto.ca, Concept3D map 1809) ----
const b = read("data/buildings.json");
const CODES = {
  bahen: "BA", brennan: "BR", daniels: "DA", donnelly: "DC", earthSci: "ES", edJohnson: "EJ", emmanuel: "EM",
  galbraith: "GB", gerstein: "SM", goldring: "GC", graham: "MU", hartHouse: "HH", innis: "IN", innisRes: "IS",
  kelly: "KL", knox: "KX", larkin: "LA", lashMiller: "LM", mcLennan: "MP", mechanical: "MC", mining: "MB",
  msb: "MS", myhal: "MY", nc45: "NR", oise: "OI", pharmacy: "PB", pratt: "PR", robarts: "RL", robartsCommon: "RL",
  rotman: "RT", sf: "SF", sidSmith: "SS", stcommons: "SU", stHildas: "HI", trinity: "TC", uc: "UC", vic: "VC",
  wallberg: "WB", wilsonHall: "WI", woodsworth: "WW",
};
for (const [k, code] of Object.entries(CODES)) b.buildings[k].code = code;
b._codes = "Building codes from U of T's official campus map (map.utoronto.ca), pulled Oct 18, 2026. Its coordinates agree with these to within a few metres.";
// The official map lists the John W. Graham Library inside the Munk School building (MU), so its pin is exact.
b.buildings.graham.name = "Munk School building (Graham Library)";
delete b.buildings.graham.approx;
write("data/buildings.json", b);

// ---- spots: hours and notes ----
const d = read("data/spots.json");
const byId = Object.fromEntries(d.spots.map((s) => [s.id, s]));
const wk = (weekday, sat, sun = sat) => ({ mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat, sun });
const src = {
  utsu: { title: "UTSU: contact us (Student Commons building hours)", url: "https://www.utsu.ca/contact-us/" },
  hhHours: { title: "Hart House: hours (building and Arbor Room)", url: "https://harthouse.ca/contact/hours" },
  hhLib: { title: "Hart House: Hart House Library (renovation notice)", url: "https://harthouse.ca/spaces/venue/hart-house-library" },
  csFaq: { title: "CS Teaching Labs FAQ: Bahen public hours [Oct 2022]", url: "https://www.teach.cs.toronto.edu/faq/" },
  engsciCR: { title: "EngSci orientation: EngSci Common Room", url: "https://orientation.engsci.utoronto.ca/engsci-common-room/" },
  innisContact: { title: "Innis College: contact us (building hours)", url: "https://innis.utoronto.ca/contact/" },
  wdwContact: { title: "Woodsworth College: contact (building hours)", url: "https://wdw.utoronto.ca/contact" },
};
const addSrc = (s, ...keys) => { for (const k of keys) if (!s.sources.some((x) => x.url === src[k].url)) s.sources.push(src[k]); };
const setWeekly = (id, week, asOf, extra = {}) => { byId[id].hours = { type: "weekly", week, asOf, ...extra }; };

setWeekly("stcommons", wk([["09:00", "21:00"]], []), "UTSU contact page (undated; no weekend hours listed)");
byId.stcommons.hoursText = "Mon–Fri 9am–9pm; weekend hours not published";
addSrc(byId.stcommons, "utsu");

for (const id of ["hh-reading", "hh-map"]) {
  setWeekly(id, wk([["07:00", "23:00"]], [["07:00", "23:00"]]), "Hart House hours page");
  byId[id].hoursText = "Building open daily 7am–11pm";
  byId[id].status = "checked";
  byId[id].sources = byId[id].sources.filter((x) => !/harthouse\.ca\/open/.test(x.url));
  addSrc(byId[id], "hhHours");
}
byId["hh-lib"].hours = { type: "unknown" };
byId["hh-lib"].hoursText = "Closed for renovation from May 1, 2026; reopening not yet confirmed";
byId["hh-lib"].notes = "Closed for renovation from May 1, 2026. Hart House said it would reopen later in the summer with more study space, but hasn’t confirmed a date, so check before going.";
byId["hh-lib"].status = "scout";
byId["hh-lib"].sources = byId["hh-lib"].sources.filter((x) => !/harthouse\.ca\/open/.test(x.url));
addSrc(byId["hh-lib"], "hhLib");

setWeekly("hh-arbor", { ...wk([["08:30", "19:00"]], [["09:00", "15:00"]]), sun: [] }, "Hart House hours page (it lists Saturday 9–3 but also says the café is closed on weekends)");
byId["hh-arbor"].hoursText = "Mon–Fri 8:30am–7pm · Sat 9am–3pm (conflicting note says weekends closed)";
addSrc(byId["hh-arbor"], "hhHours");

setWeekly("bahen-3", wk([["08:00", "23:00"]], []), "CS Teaching Labs FAQ, Oct 2022 (weekends: CS TCard only)", { dated: true });
byId["bahen-3"].hoursText = "Open to everyone Mon–Fri 8am–11pm; TCard (CS) at other times";
addSrc(byId["bahen-3"], "csFaq");

setWeekly("eng-engsci", wk([["00:00", "24:00"]], [["00:00", "24:00"]]), "EngSci orientation page (24/7 during the school year)");
Object.assign(byId["eng-engsci"], {
  hoursText: "24/7 during the school year, with your TCard",
  cardDoor: true,
  noise: "Mixed",
  status: "checked",
  notes: "Two rooms: a study room at the front (BA 2128) and a lounge at the back (BA 2124), plus rooms for quiet or group work. Gets loud at lunch. EngSci students only.",
});
addSrc(byId["eng-engsci"], "engsciCR");

for (const id of ["innis-cinema", "innis-carrels", "innis-commuter", "innis-roof"]) {
  setWeekly(id, wk([["08:00", "21:00"]], []), "Innis College contact page (building ‘typically’ open; weekends not listed)");
  byId[id].hoursText = "Building typically open Mon–Fri 8am–9pm";
  addSrc(byId[id], "innisContact");
}

setWeekly("wdw", wk([["08:30", "20:00"]], [["10:00", "18:00"]]), "Woodsworth College contact page, 2026");
byId.wdw.hoursText = "Building Mon–Fri 8:30am–8pm · Sat–Sun 10am–6pm";
addSrc(byId.wdw, "wdwContact");

d._source = d._source.replace(/\.$/, "") + ". Updated Oct 18, 2026 (scripts/update-2026-10-18.mjs).";
write("data/spots.json", d);

const types = {};
d.spots.forEach((s) => (types[s.hours.type] = (types[s.hours.type] || 0) + 1));
console.log("hours sources now:", types);
