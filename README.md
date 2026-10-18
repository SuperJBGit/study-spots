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
| `data/photos.json`, `photos/` | 47 Wikimedia Commons photos: one per building, plus photos of 7 specific spots (6 interiors, and the Graham Library's own building). Credits in `photos/CREDITS.md` |
| `research/study-spots.html` | The research sheet the spot data came from, with sources for every spot |
| `scripts/import-research.mjs` | One-time import from the research sheet |
| `scripts/update-2026-10-18.mjs` | Data update: building codes, plus hours found for 8 more spots |
| `scripts/serve.mjs` | Local static server |

## Location

"Use my location" (or picking "My location" under Near) watches your position while the app is open, so the closest spots re-rank as you walk. Once you've allowed it, the app uses your location automatically on later visits. The position never leaves the device.

## Editing data

- **Add a spot**: copy an entry in `data/spots.json`.
  - `who` is a list of rules, and any one of them is enough: `all`, `uoft`, `csc`, `md`, `prog:EngSci`, `col:Innis`, `res:NC`, `comm:UC` or `?`.
  - `hours` is `{ "type": "libcal", "lid": 8158 }`, `{ "type": "weekly", "week": { "mon": [["07:00","22:00"]], … }, "asOf": "…" }` or `{ "type": "unknown" }`.
- **Each term**: add the next term's closure days to `data/calendar.json`.
- **Spots with `"type": "unknown"` hours never appear in the top picks.** Finding their hours is the most useful data work left: 30 spots, mostly college and engineering-club lounges whose owners don't publish hours.
- **Photos**: add the file to `photos/`, an entry to `data/photos.json` (`kind: "spot"` if it shows the room itself, `"building"` otherwise), and a line to `photos/CREDITS.md`. Your own photos from the headcount walks can replace the building shots.

## Deploying

The app is plain static files with no build step, so it runs on GitHub Pages, Netlify or any static host. Before a public launch:

- Ask U of T Libraries whether using the LibCal hours feed is OK.
- Add privacy-friendly analytics, so you can see whether people come back weekly.
- Switch map tiles to a provider meant for app traffic. OpenStreetMap's own tile servers are for light use only.
