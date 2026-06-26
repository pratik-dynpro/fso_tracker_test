# Technician GPS Tracking — Implementation Plan (Vercel Test Build)

**Goal:** A working test version of the live GPS tracker, hosted on Vercel, that you (or a cab driver) can run from a phone browser while dispatch watches a live Google Map. Distance per trip is recorded automatically.

**Scope of this build:** A real, deployable test app — not production-hardened. It uses polling instead of streaming, and haversine instead of PostGIS, to stay simple on Vercel. Both can be upgraded later.

---

## 1. Tech Stack (final)

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router, TypeScript) | Frontend + API in one Vercel deploy |
| Backend | Next.js API Routes (serverless) | `/api/location`, `/api/positions` |
| Database | Neon Postgres (free tier) | Via `@neondatabase/serverless` HTTP driver |
| Distance | Haversine formula in code | No PostGIS needed for the test |
| Live updates | Client polling every 3–5s | Reliable on serverless (no WebSockets) |
| Offline buffer | IndexedDB on the phone | Queues readings, flushes on reconnect |
| Map | Google Maps JavaScript API | Dispatch page only; free tier covers testing |
| Hosting / HTTPS | Vercel | HTTPS is automatic and required for geolocation |

---

## 2. Architecture

```
 Driver phone  ──/track page──┐
  (GPS + IndexedDB queue)     │  POST /api/location  (every 10–15s; queued if offline)
                              ▼
                   Vercel serverless functions
                              │
                              ▼
                       Neon Postgres
                   (locations + trips tables)
                              ▲
   Dispatch screen ──/dispatch page──┘  GET /api/positions  (poll every 3–5s)
        (Google Map with live markers)
```

---

## 3. Data Model (Neon Postgres)

**`drivers`** — who is being tracked
- `id` (uuid, pk)
- `name` (text)
- `created_at` (timestamptz)

**`trips`** — one tracking session / job
- `id` (uuid, pk)
- `driver_id` (uuid, fk → drivers)
- `started_at` (timestamptz)
- `ended_at` (timestamptz, nullable)
- `distance_meters` (double precision, default 0) — running total
- `status` (text: `active` | `ended`)

**`locations`** — every GPS reading
- `id` (bigserial, pk)
- `trip_id` (uuid, fk → trips)
- `lat` (double precision)
- `lng` (double precision)
- `accuracy_m` (double precision, nullable)
- `recorded_at` (timestamptz) — time on the phone when captured (so offline points keep their real time)
- `received_at` (timestamptz, default now()) — time the server got it

> Distance is recalculated server-side: when a new point arrives, add the haversine distance from the previous point of the same trip to `trips.distance_meters`.

---

## 4. API Endpoints

| Method | Route | Purpose | Body / returns |
|---|---|---|---|
| POST | `/api/trips/start` | Begin a tracking session | `{driverId, name}` → `{tripId}` |
| POST | `/api/location` | Submit one or more GPS points (batch for offline flush) | `{tripId, points:[{lat,lng,accuracy,recordedAt}]}` → `{ok, distanceMeters}` |
| POST | `/api/trips/end` | Stop a session | `{tripId}` → `{ok, distanceMeters}` |
| GET | `/api/positions` | Latest position of each active trip (for the map) | → `[{tripId, name, lat, lng, recordedAt, distanceMeters}]` |
| GET | `/api/trips/:id` | Full track + total distance (for review) | → `{trip, points[]}` |

**Design notes**
- `/api/location` accepts a **batch** of points so the IndexedDB queue can flush many at once after an outage.
- Points are sorted by `recordedAt` before distance is added, so the offline trail is measured correctly.
- A simple shared secret (env var) guards the write endpoints for the test — full auth comes later.

---

## 5. Pages (UI)

### `/track` — the driver's page
- Big **Start / Stop** button.
- On start: create a trip, begin `navigator.geolocation.watchPosition`.
- Every reading → save to **IndexedDB**, then try to POST. On success, remove from queue.
- Visible status: "Tracking…", "Offline — N points queued", last sent time, current trip distance.
- Keep-awake hint (and optional Wake Lock API) so the screen doesn't sleep mid-trip.

### `/dispatch` — the map page
- Google Map centered on the active driver(s).
- Polls `/api/positions` every 3–5s, moves a marker per driver.
- Side panel: driver name, last-seen time, distance so far.

### `/` — simple landing with links to both.

---

## 6. Known Test-Time Limitations (by design)

1. **Foreground only** — browser GPS pauses if the phone is locked or the tab is backgrounded; the queue resumes on return. (This is the exact reason the proposal flagged a native app "for later.") For the cleanest test, keep the tab open and screen on.
2. **Polling, not push** — up to a few seconds' lag on the map. Fine for testing.
3. **Cold starts** — first request after idle may take ~1–2s on Vercel's free tier.
4. **Battery / data** — continuous GPS + posting uses both; expect noticeable battery drain on a long trip.

---

## 7. Environment Variables

| Var | Where to get it | Used by |
|---|---|---|
| `DATABASE_URL` | Neon dashboard → connection string | API routes |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Google Cloud Console → Maps JavaScript API | `/dispatch` |
| `INGEST_SECRET` | You invent it | Guards write endpoints |

---

## 8. Step-by-Step Setup (when we build)

1. **Scaffold** the Next.js + TypeScript project in this folder.
2. **Neon:** create a free project → copy `DATABASE_URL` → run the schema SQL (provided as `schema.sql`).
3. **Google Maps:** create a project, enable *Maps JavaScript API*, create an API key, restrict it to your Vercel domain, set a daily cap + budget alert.
4. **Local run:** `npm run dev`, test `/track` on your phone over the local network (or after first deploy).
5. **Deploy:** push to GitHub → import into Vercel → add the 3 env vars → deploy.
6. **Field test:** open `/track` on the driver's phone, hit Start; open `/dispatch` on your laptop; watch the marker move and the distance climb. End the trip and review the recorded track.

---

## 9. What This Plan Deliberately Leaves for "Later"

- Native app for locked-phone tracking
- PostGIS for spatial queries
- Real authentication / per-driver accounts
- Push streaming (SSE/WebSocket via a service that supports it)
- Geofencing for automatic arrival detection / ETA

---

## 10. Next Action

When you say go, I'll build everything in section 8.1–8.2 (project scaffold + schema + all pages and API routes) with placeholder env vars and a README walking through Neon, Maps, and Vercel setup — so you just create the accounts and paste in the keys.
