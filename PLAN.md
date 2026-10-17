# Study Spots: plan for v0.1

Written Oct 16, 2026. Facts marked **[sourced]** come from the research sheet (https://claude.ai/artifact/4GAZyy5QuKBjtKxbjh4pmS), which links every source. Everything else is judgement.

## The one job

Answer **"where can I study right now, near here?"** in under five seconds, for *this* student (their faculty, college and residence), at *this* hour.

Everything else in the app (the map, browsing, saved spots) supports that one answer.

## Who it's for first

1. **Commuter students with gaps between classes.** They have nowhere to go between classes except campus.
   - **[sourced]** 85% of Innis students live off campus, more than 3,000 Vic students commute, and Woodsworth says the vast majority of its students are commuters.
2. **First- and second-years** who only know Robarts and Gerstein.
3. **Everyone in midterm and exam season**, when the default spots fill up.

## How people will use it

| Moment | How often | What they do |
|---|---|---|
| Gap between classes | Daily | Open the app. It shows "Near Bahen · 1 h" and the top 3 spots open for the whole gap, each with walk time, closing time and noise. Tap one and go. If it's full, tap **Full? Next spot**. |
| Late night | Weekly, daily in exams | Same screen after 9pm. Only places open late come up (Robarts Common is 24 h Monday to Thursday). |
| Group work | Weekly | Turn on **Group**. Collaborative spots come up first, with a Book link where the room is bookable. |
| First week / curiosity | Once a term | Explore tab: a map and list of every spot you can use, including your college's and program's own rooms. |

## Why it beats what they do now

| | Habit (go to Robarts) | U of T Libraries "Find a space" | Google Maps | This app |
|---|---|---|---|---|
| Non-library spots (atria, lounges, the Pit, Myhal floors) | no | no | building only | yes |
| Spots only *you* can use (your college, program, residence) | no | no | no | yes |
| Hides spots you *can't* use | no | n/a | no | yes |
| Open now, and for how long | memory | per library | sometimes | yes, from the official hours feed |
| Ranked by walk from where you are | no | no | yes | yes |
| Busyness | luck | no | building-level for some places | not in v0.1 (needs the headcount test) |

## The niche

**The only place that answers "where can *I* study right now" across all of St. George**: libraries, plus the lounges, atria and members-only rooms that no official tool lists, filtered to what you're allowed into.

The hard-to-copy part is the data, not the code: 85 spots with access rules, hours and sources. Each faculty and college publishes its own piece, but nobody has put them together.

## Keeping people coming back (the weakest part, so be honest)

**Should work:**
- **It runs on a daily need.** Every gap between classes is a reason to open it. It has to be faster than habit: two taps or fewer to an answer, and it opens on the answer, not a menu.
- **Saved spots with live open/closed status**, so a quick check is enough even after you know your favourites.
- **Hours change** (holidays, reading week, December). The app knows; memory doesn't.
- **Exam season** brings people back every term.
- **Home-screen install.** A website saved to the home screen opens like an app.

**Probably won't on its own:** discovery. Once someone knows 3–4 spots, browsing stops. If the "right now" answer isn't better than their habit, they leave.

**Later hooks, only if v0.1 earns them:**
- Predicted busyness, but only if the October headcount test passes.
- "Full? Next" reports feeding busyness.
- Timetable-aware suggestions ("after your 2pm in BA…"). This needs a timetable export, so check whether ACORN offers one.
- A home-screen widget (native app only).

**Measure before building more.** The number that matters is the share of users who come back in a later week. Add privacy-friendly page analytics before any public launch (no accounts, no personal data). Kill-or-continue call after one month of real use: if under ~20% come back weekly **[judgement]**, it's a guide, not an app. Ship it as a guide and stop.

## v0.1 scope

**In**
- Onboarding: three questions (faculty and program, college for Arts & Science only, where you live), plus an optional "taking a CSC course".
- **Now** screen: where you are (pick a building or use location), how long you have, and preference chips (Quiet, Group, Outlets, Food OK). Shows the top 3 open spots with reasons, plus "Full? Next spot".
- **Explore**: map and list of every spot you can use, with open/closed shown.
- Spot detail: today's and this week's hours, who can use it, the door rule, notes, sources, directions, and a Book link for bookable rooms.
- **Saved** spots.
- Library hours live from U of T Libraries' LibCal feed, cached once a day. Fixed hours for non-library spots where a source exists, otherwise "hours unknown".

**Out (on purpose)**
- Accounts, a backend, crowdsourcing, busyness, notifications.
- Spots with unknown hours never appear in the top 3. Sending someone to a locked door is worse than showing one fewer option.

## How it works

- **Static website, no build step.** Plain HTML, CSS and JavaScript modules. Leaflet with OpenStreetMap tiles for the map. Any static host works, such as GitHub Pages.
- **Data**:
  - `data/spots.json` holds the 85 spots, imported from the research sheet by `scripts/import-research.mjs`. It's hand-edited from now on.
  - `data/buildings.json` holds building coordinates from OpenStreetMap footprints, checked against Google Maps (Robarts matches within about 6 m).
  - `data/calendar.json` holds university closure days and the libraries whose holiday hours the feed is missing.
- **Hours**: `src/hours.js` fetches `api_hours_grid.php` (iid 478) once a day into localStorage, and falls back to the cache if the fetch fails.
  - The feed's day formats: open with times, `24hours`, `closed`, `ByApp`, `text`, `not-set`.
  - Days that run past midnight are joined to the next day (Robarts Common runs 24 h from Sunday 10am to Friday 11pm).
- **Logic** lives in `src/logic.js` as pure functions (who can use a spot, open-now, walk time, ranking), tested with `node --test`.
- **Privacy**: the profile, saved spots and last building stay in the browser. Location, if allowed, is used on the device and never sent anywhere.

## Ranking [judgement]

**Filter first:**
- Spots you can't use are dropped.
- Spots not confirmed open for the time you have are dropped.
- Bookable rooms and the classroom-finder entry are dropped, because you can't just walk in.

**Then score (lower is better):**
- **Walk time**: straight-line distance × 1.3 for real paths, at 80 m/min.
- **Penalties**:
  - A noise mismatch: Quiet wanted but the spot is social, or Group wanted but it's silent.
  - Outlets or food wanted but unknown or absent.
  - Less-verified data (partial or scout).
  - Unclear access.
  - Closing within 30 minutes of the end of your time.
- **Bonus**: a members-only room you're entitled to, since those are usually less crowded.

**Show the reasons** on each card: walk, open until, noise, outlets, "only for your college".

The top 3 come from different buildings, so a backup is never just another floor of the same full library.

## Open questions

1. **Headcount results** (Oct 5–23): do they support predicted busyness? This decides v0.2.
2. **Ask U of T Libraries** whether using the LibCal feed in a public app is OK.
3. **Hosting**: GitHub Pages under your account?
4. **ACORN timetable export**: does it exist? That decides whether timetable-aware suggestions are possible.
5. **Winter 2027 closure days** need adding to `data/calendar.json` once the calendar is out.
