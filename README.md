# McCarthy Tyre — Technician GPS Tracking

Live GPS tracking for field technicians, built for a Vercel test deployment.

- **`/track`** — the technician's phone page: reads GPS, queues readings offline (IndexedDB), sends to the backend.
- **`/dispatch`** — the dispatch console: live Google Map with each technician, measured vs estimated track, distance per job.
- **`/api/*`** — serverless backend on Vercel, storing data in **Neon Postgres**.

Distance is computed in code (haversine); a time gap > 60s between readings is flagged as an **estimated** segment so it never mixes with measured miles.

---

## What you need (all have free tiers)

1. **Node.js 18+** installed locally.
2. A **Neon** account → a Postgres database. https://neon.tech
3. A **Google Maps JavaScript API key**. https://console.cloud.google.com
4. A **Vercel** account for hosting. https://vercel.com
5. (optional) A **GitHub** account to connect to Vercel.

---

## 1. Install

```bash
npm install
```

## 2. Configure environment

Copy `.env.example` to `.env.local` and fill it in:

```bash
cp .env.example .env.local
```

| Variable | Where to get it |
|---|---|
| `DATABASE_URL` | Neon dashboard → your project → **Connection Details** → copy the **Pooled connection** string (`...-pooler...`). |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Cloud Console → **APIs & Services → Library** → enable **Maps JavaScript API** → **Credentials → Create API key**. Restrict it to your domain when you deploy. |
| `INGEST_SECRET` | Any random string you invent. The technician types it once on `/track`. **Leave blank to skip the check while testing.** |

## 3. Create the database tables

```bash
npm run db:setup
```

This runs `db/schema.sql` against your Neon database (creates `drivers`, `trips`, `locations`).

## 4. Run locally

```bash
npm run dev
```

- Open **http://localhost:3000/dispatch** on your computer.
- Open **http://localhost:3000/track** on the same computer to test, **or** on your phone (see note below).

> **Phone testing needs HTTPS.** `localhost` is treated as secure on the same machine, but your phone hitting your PC's LAN IP is not — the browser will block location. Easiest path: do step 5 (deploy) and test the phone against the live `https://…vercel.app` URL. (Or use a tunnel like `ngrok http 3000` for an HTTPS URL during local dev.)

## 5. Deploy to Vercel

**Option A — via GitHub (recommended):**
1. Push this folder to a GitHub repo.
2. In Vercel → **Add New → Project** → import the repo.
3. Add the three environment variables (same as `.env.local`) in **Project → Settings → Environment Variables**.
4. Deploy. You get a `https://<project>.vercel.app` URL.

**Option B — via CLI:**
```bash
npm i -g vercel
vercel            # follow prompts
vercel env add DATABASE_URL
vercel env add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
vercel env add INGEST_SECRET
vercel --prod
```

## 6. Field test

1. On the driver's phone, open `https://<your-app>.vercel.app/track`.
2. Enter the driver name (and job ref / passcode if used). Tap **Start trip**, allow location.
3. On your laptop open `…/dispatch` — the marker appears and moves; distance ticks up.
4. To test a gap, drive through (or simulate) a no-signal stretch / lock the phone briefly — readings queue, then fill in (and a >60s break is drawn as a dashed **estimated** segment).
5. Tap **End trip** to finish; the trip's totals are stored.

---

## How the pieces map to the proposal

| Proposal concept | In this code |
|---|---|
| Phone as edge GPS device | `app/track/page.tsx` (`watchPosition`) |
| Offline buffering | `lib/queue.ts` (IndexedDB) + flush loop |
| Cloud ingestion | `app/api/location/route.ts` |
| Distance + gap detection | `lib/geo.ts` + ingest logic |
| Live dispatch map | `app/dispatch/page.tsx` (polls `/api/positions`) |
| Database | Neon Postgres — `db/schema.sql` |

## Capacitor (background tracking) build

The same code base also ships as a native Android/iOS shell so the technician's
location is recorded with the screen off, in a pocket, or through a signal
dead-zone. See `docs/superpowers/plans/2026-06-26-capacitor-background-tracking.md`
for the full build and field-test procedure.

Quick start (Android):

```bash
npm run cap:sync         # builds out/, copies into android/
npx cap open android     # then Run from Android Studio onto a real device
```

iOS (on a Mac):

```bash
npx cap add ios          # one-time; needs Xcode + CocoaPods
npm run cap:sync
npx cap open ios         # paste docs/capacitor-ios-info-plist.snippet.xml into Info.plist
```

The Capacitor build talks to the **same Vercel API** as the browser app — set
`NEXT_PUBLIC_API_BASE` in `.env.capacitor` to your Vercel URL before building.
The technician shell only ships `/` and `/track`; `/dispatch` and `/trip/[id]`
stay on Vercel.

## Known test-time limits (by design)

- Browser GPS runs only while the page is **open and the phone unlocked** (Wake Lock keeps the screen on). True locked-phone tracking is what the Capacitor build above solves.
- Live updates use **polling** (a few seconds' lag), not push.
- Gap distance is a **straight-line estimate**; swap in Google Directions API later for road-snapped estimates.

## Project structure

```
app/
  page.tsx              landing
  track/page.tsx        technician tracker (client)
  dispatch/page.tsx     dispatch console (client)
  api/
    trips/start         POST  begin a trip
    trips/end           POST  end a trip
    trips/[id]          GET   full track + totals
    location            POST  ingest GPS points (batch)
    positions           GET   live positions for the map
lib/
  db.ts  geo.ts  auth.ts  queue.ts  types.ts
db/schema.sql           Neon schema
scripts/setup-db.mjs    runs the schema
```
