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

The tests use a real slice of the LibCal hours feed (`test/fixtures/`). They cover access rules, 24-hour days, holiday overrides, ranking, busyness, the hours cache and the photo data. `test/backend.test.js` runs the Apps Script backend in Node (`backend/harness.mjs` stands in for Google's services).

## Files

| Path | What |
|---|---|
| `index.html`, `styles.css` | The page: Now, Explore (map + list), Saved, You |
| `src/logic.js` | Pure logic: who can use a spot, open now, walk time, busyness, ranking |
| `src/crowd.js`, `src/config.js` | Busyness reports and photo uploads, and the backend URL (empty = switched off) |
| `src/hours.js` | LibCal hours feed, cached once a day in the browser |
| `src/app.js` | UI |
| `data/spots.json` | 85 spots: access rules, hours source, noise, outlets, food, notes, sources |
| `data/buildings.json` | Building coordinates (OpenStreetMap footprints) and official building codes (U of T campus map) |
| `data/calendar.json` | University closure days, and libraries whose holiday hours the feed lacks |
| `data/photos.json`, `photos/` | 31 inside photos across 19 spots, each matched to the spot it shows, plus an outside photo of each building as a fallback (labelled Outside). Credits in `photos/CREDITS.md` |
| `backend/Code.gs` | The crowd-data backend: a Google Apps Script web app writing to a Google Sheet (see Crowd data) |
| `backend/harness.mjs` | Runs `Code.gs` in Node, for the tests and the mock backend |
| `research/study-spots.html` | The research sheet the spot data came from, with sources for every spot |
| `scripts/import-research.mjs` | One-time import from the research sheet |
| `scripts/update-2026-10-18.mjs` | Data update: building codes, plus hours found for 8 more spots |
| `scripts/serve.mjs` | Local static server |
| `scripts/mock-backend.mjs` | Local stand-in for the backend (`npm run mock-backend`) |
| `scripts/pull-photos.mjs` | Imports approved photo submissions; run daily by `.github/workflows/pull-photos.yml` |
| `scripts/credits.mjs` | Rebuilds `photos/CREDITS.md` from `data/photos.json` |

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
- **Photos**: put the file (resized to fit 800 × 600) in `photos/`, add an entry under `photos` in `data/photos.json` with `kind: "spot"` and a caption saying exactly what it shows, then add its id to the spot's list under `spots`. The first photo in the list goes on the card, and the detail sheet shows all of them as a swipeable strip. Any inside photo replaces the outside fallback for that spot. Run `node scripts/credits.mjs` to rebuild `photos/CREDITS.md`; the tests check every photo has a file and a credit. Your own photos from the headcount walks are the best source: 66 spots still only have the outside shot. Mark your own photos `"own": true` (credited as "taken for Study Spots"). Photos other students send arrive through the review queue below.

## Crowd data: busyness and photos

How busy a spot is comes from students, so the features are built around things people will actually do:

- **The Full button counts.** Tapping "Full? Show the next spot" while you're at that spot sends a "Full" report. People already do this for themselves.
- **One question, at the right moment.** When GPS puts you at a building with spots (fix within 100 m), the Now screen asks "How busy is … right now?" with three buttons. It asks at most once per building every 3 hours and 4 times a day. If you opened or got directions to one of that building's spots in the last 2 hours, it asks about that one.
- **What everyone sees.** A report shows for 45 minutes ("Full · 12 min ago") and pushes a full spot out of the top picks. Over weeks, reports build "Usually busy around now", which needs at least 3 reports for that weekday or weekend hour, from at least 2 days. No reports never means "quiet". Spot details show the usual pattern through the day.
- **Photos.** "Add a photo" appears when a spot has no inside photo and you're there. The phone shrinks it to 800 × 600 and re-encodes it, which drops GPS position, camera model and time. It waits for your approval.
- **Headcount walks.** You > "I'm doing headcount walks" shows reporting and photo upload on every spot wherever you are, with a box for how many people you counted. Use it to seed data, and give it to friends who help.
- **Privacy.** A report sends the spot, the answer, the time and a random code for the phone (for rate limits). No location and no account.

### Set up the backend (once, about 5 minutes)

1. Go to https://script.google.com, click **New project**, and name it "Study Spots backend".
2. Replace everything in `Code.gs` with the contents of `backend/Code.gs`, and save.
3. Pick `setup` in the function menu and click **Run**. Google asks you to allow access: it needs Sheets (the data), Drive (the photo folder) and external requests (to read the spot list from the site). The log then shows links to the new "Study Spots data" sheet and the "Study Spots photo submissions" folder.
4. **Deploy > New deployment**, type **Web app**, Execute as **Me**, Who has access **Anyone**. Deploy, and copy the Web app URL (it ends in `/exec`).
5. Put that URL in `src/config.js` as `API_URL` and push. Everything switches on.

To change the backend later, paste the new `Code.gs`, then **Deploy > Manage deployments**, edit the deployment and choose **New version**. That keeps the same URL.

### Reviewing photos

In the sheet's **Photos** tab, each row is a submission with its caption, credit and status. The photo itself is in the "Study Spots photo submissions" Drive folder, named by its id. Set the status to **approved** or **rejected**. Every morning the **Import approved photos** GitHub Action downloads approved photos into `photos/`, adds them after the spot's existing photos, rebuilds the credits and redeploys. Run it from the repo's Actions tab to do it straight away. Reject photos with recognizable faces, screens or anything that isn't the spot.

### The two-week test

The sheet's **Summary** tab tracks how often the question was shown and answered, reports over the last 7 days, how many phones reported, "Full" taps, and reports per spot. The bar to keep going: **at least 1 in 4 questions answered**, and **the top 5 spots getting a report most weekdays**. If it misses, busyness can come from headcount walks alone.

### Try it locally

```
npm run mock-backend                          # or add --seed for three weeks of made-up reports
```

Then open http://localhost:8080/?api=http://localhost:8787. The `?api=` override only works on localhost. The mock runs the real `Code.gs`; `http://localhost:8787/approve?id=all` approves pending photos, and `API_URL=http://localhost:8787 npm run pull-photos` imports them.

## Deploying

The app is plain static files with no build step, so it runs on GitHub Pages, Netlify or any static host. Before a public launch:

- Ask U of T Libraries whether using the LibCal hours feed is OK.
- Add privacy-friendly analytics, so you can see whether people come back weekly.
- Switch map tiles to a provider meant for app traffic. OpenStreetMap's own tile servers are for light use only.
