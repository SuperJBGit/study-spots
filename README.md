# Study Spots (St. George)

Where can I study right now, near here? Open spots ranked by walk time, filtered to the rooms you're allowed into. See `PLAN.md` for the why.

## Run it

```
npm start            # or: node scripts/serve.mjs 8080
```

Open http://localhost:8080. Add `?now=2026-10-21T14:10` to pin the clock and see another day or time.

## Test it

```
npm test
```

The tests use a real slice of the LibCal hours feed (`test/fixtures/`). They cover access rules, 24-hour days, holiday overrides, ranking and the hours cache.

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css` | The page: Now, Explore (map + list), Saved, You |
| `src/logic.js` | Pure logic: who can use a spot, open now, walk time, ranking |
| `src/hours.js` | LibCal hours feed, cached once a day in the browser |
| `src/app.js` | UI |
| `data/spots.json` | 85 spots: access rules, hours source, noise, outlets, food, notes, sources |
| `data/buildings.json` | Building coordinates (OpenStreetMap footprints) and official building codes (U of T campus map) |
| `data/calendar.json` | University closure days, and libraries whose holiday hours the feed lacks |
| `data/photos.json`, `photos/` | 14 inside photos matched to the spot they show, plus an outside photo of each building as a fallback (labelled Outside). Credits in `photos/CREDITS.md` |
| `research/study-spots.html` | The research sheet the spot data came from, with sources for every spot |
| `scripts/import-research.mjs` | One-time import from the research sheet |
| `scripts/update-2026-10-18.mjs` | Data update: building codes, plus hours found for 8 more spots |
| `scripts/serve.mjs` | Local static server |

## Install on a phone

Open the site in Chrome on Android, then menu > Install app (or Add to Home screen). It installs like an app and updates every time the site does. On iPhone: Safari > Share > Add to Home Screen.

## Location

"Use my location" (or picking "My location" under Near) watches your position while the app is open, so the closest spots re-rank as you walk. Once you've allowed it, the app uses your location automatically on later visits. The position never leaves the device.

## Design

- **Colours** follow U of T's Colour Quick Guide: U of T Blue `#1e3765` carries the app, and the secondary colours appear only as status signals (green open, red closed, yellow highlight, purple "yours"), since the guide says to use them as accents. Dark mode is deep blue rather than black, as the guide advises against black backgrounds. The tokens are at the top of `styles.css`.
- **Type**: Source Serif 4 for spot names and headings, Public Sans for everything else (both Google Fonts).
- **Layout**: one large best pick, then compact rows. Status is a coloured dot with plain text. A spot with no photo shows its building's official code.
- The About section says the app isn't affiliated with U of T. Keep that line while the app uses U of T's colours.

## Editing data

- **Add a spot**: copy an entry in `data/spots.json`.
  - `who` is a list of rules, and any one of them is enough: `all`, `uoft`, `csc`, `md`, `prog:EngSci`, `col:Innis`, `res:NC`, `comm:UC` or `?`.
  - `hours` is `{ "type": "libcal", "lid": 8158 }`, `{ "type": "weekly", "week": { "mon": [["07:00","22:00"]], … }, "asOf": "…" }` or `{ "type": "unknown" }`.
- **Each term**: add the next term's closure days to `data/calendar.json`.
- **Temporarily closed** (construction, say): add `"closed": { "reason": "construction", "reported": "2026-10-18", "text": "…" }` to the spot. It then shows as "Closed for construction" everywhere and is never suggested. Delete the field when it reopens. The Pit has one now.
- **Spots with `"type": "unknown"` hours never appear in the top picks.** Finding their hours is the most useful data work left: 30 spots, mostly college and engineering-club lounges whose owners don't publish hours.
- **Photos**: an inside photo goes under `photos` in `data/photos.json` with `kind: "spot"` and a caption saying exactly what it shows, mapped from the spot id under `spots`; it then replaces the outside fallback for that spot. Add a line to `photos/CREDITS.md`. Your own photos from the headcount walks are the best source: about 70 spots still only have the outside shot.

## Deploying

The app is plain static files with no build step, so it runs on GitHub Pages, Netlify or any static host. Before a public launch:

- Ask U of T Libraries whether using the LibCal hours feed is OK.
- Add privacy-friendly analytics, so you can see whether people come back weekly.
- Switch map tiles to a provider meant for app traffic. OpenStreetMap's own tile servers are for light use only.
