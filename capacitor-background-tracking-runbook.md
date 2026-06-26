# FSO Background Tracking — Implementation Runbook (free community plugin)

Wrapping your existing FSO web app in a Capacitor native shell and running
`@capacitor-community/background-geolocation` for screen-off / backgrounded / dead-zone tracking.

> **Plugin note.** This runbook uses the **free** `@capacitor-community/background-geolocation`,
> per your request. Your build spec was written for the **paid** `@transistorsoft/...` plugin.
> The free plugin only *delivers* locations to your JS — it has **no offline queue, no retry,
> no batching, no `extras`, no motion detection**. So **Phase 3 (the offline queue) is work you
> must do yourself**. With the paid plugin that phase disappears. See the last section for the
> switch path.

---

## Phase 0 — Decisions to lock before coding

1. **Capacitor version.** Current is **v8**; the free plugin is only tested to **v7**.
   This runbook pins **Capacitor 7**. Retest on 8 only if you have a reason to.
2. **How the UI loads.** **Bundle built web assets into the app** (recommended — works with no
   signal). Do *not* point Capacitor at your live Vercel URL for a field app.
3. **If your Vercel app is Next.js.** Capacitor serves static files, so you need
   `output: 'export'` (no SSR, no API routes, no middleware in the wrapped app). API routes must
   move to your real backend (`API_BASE`). If you're on a plain SPA (Vite/CRA/Angular/Vue), skip this.
4. **Backend / DB / dispatcher.** Reused unchanged from the spec (§06–§09). The *only* backend
   adaptation is making the ingest endpoint accept the payload shape you'll send from the free
   plugin — and the easy move is to **mirror the spec's exact contract** so §06 works as written.

---

## Phase 1 — Capacitor shell

Run these in the root of your existing web app repo.

```bash
# Pin Capacitor 7 to match the free plugin's tested matrix
npm i @capacitor/core@7
npm i -D @capacitor/cli@7
npx cap init        # app name + package id (e.g. com.mccarthy.fso)
```

`npx cap init` writes `capacitor.config.ts`. Set `webDir` to your build output:

- Vite → `dist`
- CRA → `build`
- Angular → `dist/<project>`
- Vue CLI → `dist`
- **Next.js (static export)** → `out`

```ts
// capacitor.config.ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mccarthy.fso',
  appName: 'McCarthy FSO',
  webDir: 'dist',                 // match your framework above
  server: { androidScheme: 'https' },
  android: {
    useLegacyBridge: true         // REQUIRED: stops Android killing updates after 5 min (plugin issue #89)
  }
};
export default config;
```

> **Next.js only:** set `output: 'export'` in `next.config.js`, confirm the build produces `out/`,
> and remove any reliance on server-side rendering / API routes inside the wrapped app.

Add platforms, build the web app, sync:

```bash
npm i @capacitor/android@7 @capacitor/ios@7
npm run build            # produces webDir
npx cap add android
npx cap add ios
npx cap sync
```

**Phase 1 acceptance:** open the native project and run it on a **real device**, confirm the FSO
UI loads inside the shell.

```bash
npx cap open android     # then Run from Android Studio onto a real phone
npx cap open ios         # then Run from Xcode onto a real iPhone
```

---

## Phase 2 — Plugin install + permissions

```bash
npm i @capacitor-community/background-geolocation
npx cap sync
```

### iOS — `ios/App/App/Info.plist`

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>Shows dispatch your location while you're on a job.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Lets dispatch see your location during a job even when the screen is off.</string>
<key>UIBackgroundModes</key>
<array>
  <string>location</string>
</array>
```

At runtime you must get the user to grant **"Always"** (not just "While Using"), or iOS suspends
background updates. The plugin's permission prompt fires on first `addWatcher`; the OS shows the
"Always Allow" upgrade prompt after the app has been backgrounded once while watching.

### Android — `android/app/src/main/AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" /> <!-- API 34+ -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />          <!-- API 33+ -->
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

Notification channel name / icon (optional) in `android/app/src/main/res/values/strings.xml`:

```xml
<string name="capacitor_background_geolocation_notification_channel_name">Trip tracking</string>
<string name="capacitor_background_geolocation_notification_icon">drawable/ic_tracking</string>
```

> The persistent foreground notification is **mandatory** while tracking and **cannot be hidden** —
> this is an OS rule, not a plugin setting. Word it for the technician.

`ACCESS_BACKGROUND_LOCATION` and `POST_NOTIFICATIONS` are **runtime** grants on modern Android —
request them explicitly (e.g. via `@capacitor/local-notifications` for the notification permission)
before starting a trip.

### Native HTTP (required — do not skip)

Android throttles WebView-initiated HTTP after 5 minutes backgrounded, which would silently kill
your uploads mid-trip. Route uploads through **CapacitorHttp** (built into Capacitor core):

```ts
// capacitor.config.ts → add
plugins: { CapacitorHttp: { enabled: true } }
```

With it enabled, `fetch`/`XHR` from the WebView are patched to go native. Verify your upload calls
actually hit native (check Android logcat for the native HTTP path) rather than assuming.

**Phase 2 acceptance (debug, no licence — there's no licence with this plugin anyway):**
on a **real device**, start a watcher, lock the screen, walk around, confirm locations keep logging
to the console / your endpoint while backgrounded.

---

## Phase 3 — The offline queue (YOU build this; the spec offloaded it to Transistorsoft)

This is the phase that does not exist in the spec because Transistorsoft does it internally. With
the free plugin you own it. Goal: **never lose a point, never double-count one.**

Install helpers:

```bash
npm i @capacitor/preferences @capacitor/network uuid
# for larger buffers prefer SQLite instead of Preferences:
# npm i @capacitor-community/sqlite
```

Design:

- The watcher callback fires with a location → **stamp a stable `client_ping_id` (uuid)** and the
  current trip identifiers → **write to a local durable queue first** (before any network attempt).
- A **flush loop** tries to upload queued pings (batched). On **HTTP 2xx**, delete them from the
  queue. On any non-2xx or network error, **leave them** and retry later.
- Trigger flush on: each new ping, a timer (e.g. every 15–30 s), and `Network` "online" events.
- The **stable uuid is what makes retries safe** — the server upserts on it, so a re-sent ping is
  ignored, not duplicated.

```ts
import { registerPlugin } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { Network } from '@capacitor/network';
import { v4 as uuidv4 } from 'uuid';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';

const BackgroundGeolocation =
  registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

const API_BASE = '...';            // your FastAPI base URL (NOT Vercel unless that's the backend)
const QUEUE_KEY = 'ping_queue';

let deviceToken = '...';           // per-technician bearer
let activeTrip: { trip_id: string; technician_id: string; event_id: string } | null = null;
let watcherId: string | null = null;
let flushing = false;

async function loadQueue(): Promise<any[]> {
  const { value } = await Preferences.get({ key: QUEUE_KEY });
  return value ? JSON.parse(value) : [];
}
async function saveQueue(q: any[]) {
  await Preferences.set({ key: QUEUE_KEY, value: JSON.stringify(q) });
}

// Build a payload that MIRRORS the spec's data contract (§05) so the backend in §06 works unchanged.
function toPing(loc: any) {
  return {
    uuid: uuidv4(),
    timestamp: new Date(loc.time).toISOString(),
    coords: {
      latitude: loc.latitude,
      longitude: loc.longitude,
      accuracy: loc.accuracy,
      speed: loc.speed,
      heading: loc.bearing            // free plugin calls it "bearing"
    },
    is_moving: true,
    extras: activeTrip ?? {}
  };
}

async function enqueue(loc: any) {
  if (!activeTrip) return;            // only record between Start and End
  const q = await loadQueue();
  q.push(toPing(loc));
  await saveQueue(q);
  flush();                           // fire-and-forget
}

async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const status = await Network.getStatus();
    if (!status.connected) return;
    let q = await loadQueue();
    while (q.length) {
      const batch = q.slice(0, 50);
      const res = await fetch(`${API_BASE}/api/locations`, {   // goes native via CapacitorHttp
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deviceToken}`
        },
        body: JSON.stringify({ location: batch })  // matches httpRootProperty:"location" from the spec
      });
      if (res.status < 200 || res.status >= 300) break;        // keep queue, retry later
      q = q.slice(batch.length);
      await saveQueue(q);                                       // 2xx => safe to drop
    }
  } catch {
    /* offline / error: queue stays intact, retried on next trigger */
  } finally {
    flushing = false;
  }
}

// retry triggers
Network.addListener('networkStatusChange', s => { if (s.connected) flush(); });
setInterval(flush, 20000);
```

> Replace `Preferences` with `@capacitor-community/sqlite` if trips can buffer thousands of points
> offline — Preferences is fine for short outages, not for hours of dead zone.

---

## Phase 4 — Trip lifecycle (wire to the existing job screen)

```ts
// START — tech taps Start on a job
async function startTrip(trip_id: string, technician_id: string, event_id: string) {
  activeTrip = { trip_id, technician_id, event_id };

  watcherId = await BackgroundGeolocation.addWatcher(
    {
      backgroundTitle: 'Trip active',
      backgroundMessage: 'Sharing your location with dispatch while on a job.',
      requestPermissions: true,
      stale: false,
      distanceFilter: 25          // metres between points while moving (tune 20–50)
    },
    (location, error) => {
      if (error) {
        if (error.code === 'NOT_AUTHORIZED') BackgroundGeolocation.openSettings();
        return;
      }
      enqueue(location);          // -> durable queue -> flush
    }
  );

  await fetch(`${API_BASE}/api/trips/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
    body: JSON.stringify({ trip_id, technician_id, event_id })
  });
}

// END — tech taps Complete
async function endTrip(trip_id: string) {
  if (watcherId) { await BackgroundGeolocation.removeWatcher({ id: watcherId }); watcherId = null; }
  await flush();                  // push anything still queued before finalising
  activeTrip = null;
  await fetch(`${API_BASE}/api/trips/${trip_id}/end`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deviceToken}` }
  });
}
```

Differences from the spec's Transistorsoft snippet (§4.4), called out so they don't bite you:

- No `setConfig({ extras })` — you attach `trip_id/technician_id/event_id` yourself in `toPing`.
- No `getCurrentPosition` — for an immediate origin fix, add `@capacitor/geolocation` and take one
  reading at Start, or just use the first watcher location.
- No `start()/stop()` — `addWatcher`/`removeWatcher` are the on/off switch.

---

## Phase 5 — Backend ingest + schema (reuse spec §06–§07)

Because Phase 3 sends the spec's exact payload shape (`{ "location": [ { uuid, timestamp, coords,
extras } ] }`), the FastAPI ingest in **§06** and the Postgres + PostGIS schema in **§07** work
**unchanged**. The non-negotiables from the spec still apply:

- **Upsert on `client_ping_id`** (`ON CONFLICT DO NOTHING/UPDATE`) — kills duplicates from retries.
- **Return HTTP 2xx only after the rows are persisted** — this is what makes the client safe to
  drop the queue. If you 2xx before the write, an outage = lost points.
- `recorded_at = timestamp` (device), `received_at = now()` (server); order by `recorded_at`.
- Extend running trip distance with the jitter filters from §08 (drop `accuracy_m > 50–100`,
  ignore < 10 m segments, reject > ~200 km/h teleports).

> If you intend to host this backend **on Vercel**: the ingest endpoint is fine, but the **SSE
> stream (§09) is a poor fit for Vercel's serverless model** (long-lived connections hit function
> timeouts). The spec uses Cloud Run for exactly this reason. Keep the dispatcher map page on
> Vercel by all means, but run the streaming backend somewhere that supports long-lived connections.

---

## Phase 6 — SSE + dispatcher map (reuse spec §09, unchanged)

No change from the agreed design: Google Maps JS, create map + markers **once**, move them as
`GET /api/stream` SSE events arrive, one marker per active technician, grey a marker after N seconds
of silence and restore on the next event.

---

## Phase 7 — End-to-end + offline test (the real proof)

On **real iOS and Android devices** (not simulators):

1. Start a trip, lock the phone, put it in a pocket, **drive**. Confirm pings keep arriving and the
   dispatcher marker moves.
2. Mid-drive, **enable airplane mode** for a few minutes, then turn it off. Confirm the **gap
   back-fills** with the real positions captured during the outage (this is your Phase 3 queue
   doing its job).
3. Confirm **no duplicate pings** after the reconnect (server upsert on `client_ping_id`).
4. Confirm **total distance** is sane vs. the actual drive.
5. Leave it parked a while — accept that the free plugin has weaker motion/stationary handling than
   Transistorsoft, so you may get more or fewer parked-state points; tune `distanceFilter`.

---

## Phase 8 — Release + distribution

- No licence key exists for this plugin (it's MIT) — nothing to buy, nothing to add for release.
- Android release build: standard signed build; ensure runtime permission flows for background
  location + notifications are solid on a clean install.
- Distribution: **MDM** for company phones, **App Store / Play Store** for personal phones. The
  "Always allow location" + visible foreground-service notification flow must work on a fresh
  install, not just on your dev device.

---

## Definition of Done — what the free plugin gives vs. what you carry

| DoD item (spec §11) | Free plugin | Notes |
|---|---|---|
| Tracking with screen off / backgrounded / in pocket | ✅ built-in | core feature of the plugin |
| Airplane-mode gap back-fills on reconnect | ⚠️ **your Phase 3** | not provided; you built the queue |
| No duplicate pings after retry | ⚠️ shared | server upsert + your stable uuid |
| Total distance server-side, jitter-filtered | ✅ backend | unchanged from spec |
| Dispatcher live markers + stale-greying | ✅ backend/web | unchanged from spec |
| Verified on real iOS + Android | ✅ | your test, Phase 7 |
| "Always allow" + Android foreground notification | ✅ built-in | you handle runtime prompts |

---

## If you later switch to the paid Transistorsoft plugin

You'd **delete Phase 3 entirely** (its SQLite + autoSync replaces your queue), swap `addWatcher`
for `BackgroundGeolocation.ready()` + `start()/stop()`, and use `setConfig({ extras })` for trip IDs
— i.e. the spec as originally written (§4.3–§4.4). Everything in Phases 5–8 stays the same.
You can evaluate it **free in debug builds** first; the $399 licence is only needed for the Android
*release* build.
