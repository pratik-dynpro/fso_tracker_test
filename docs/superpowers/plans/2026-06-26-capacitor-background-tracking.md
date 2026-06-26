# Capacitor Background Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the existing McCarthy Tyre Next.js tracking app in a Capacitor native shell using the free `@capacitor-community/background-geolocation` plugin so the technician's location is recorded while the screen is off, the phone is pocketed, the app is backgrounded, or signal is lost — and that nothing already deployed (Vercel + Neon) breaks.

**Architecture:**
- The existing Next.js app remains the canonical deployment on Vercel — it keeps serving the `/dispatch` page and the `/api/*` routes against Neon Postgres unchanged.
- A second build artifact (the same repo, the same UI for `/track`, but with `output: 'export'` and `NEXT_PUBLIC_API_BASE` pointed at the Vercel URL) is shipped inside a Capacitor 7 shell as `com.mccarthy.fso`.
- On native, the existing `navigator.geolocation.watchPosition` path is swapped for `BackgroundGeolocation.addWatcher` and the browser `IndexedDB` queue (`lib/queue.ts`) is replaced with a Capacitor Preferences-backed queue (`lib/queue-native.ts`); both queues sit behind one `lib/tracker.ts` abstraction so `app/track/page.tsx` only calls a single API.
- Every queued ping carries a stable `clientPingId` (UUID) and the backend `/api/location` upserts on it, so retries are safe and offline gaps back-fill without duplicating distance.

**Tech Stack:**
- Capacitor `7.x` (core, cli, android, ios)
- `@capacitor-community/background-geolocation` (MIT, free)
- `@capacitor/preferences`, `@capacitor/network`
- `uuid` (already implied by §3 of the runbook; add as a dep)
- Existing: Next.js 14, TypeScript, Neon Postgres, IndexedDB (kept as the web fallback)
- Android Studio + Xcode for native builds; a real Android phone and a real iPhone for acceptance

## Global Constraints

These are project-wide requirements copied verbatim from `capacitor-background-tracking-runbook.md` and `README.md`. They apply to every task below.

- **Capacitor 7 only.** Pin every `@capacitor/*` and platform package at `^7`. Do not upgrade to 8 — the free plugin is only tested to v7 (Runbook Phase 0).
- **App ID:** `com.mccarthy.fso`. **App name:** `McCarthy FSO`.
- **Web assets are bundled into the app.** `webDir` must point at the local static build output; do not configure Capacitor to load a remote URL (Runbook Phase 0 §2).
- **Next.js static export.** The Capacitor build must run with `output: 'export'` and produce `out/`. The wrapped app must not depend on SSR, API routes, or middleware (Runbook Phase 0 §3).
- **Backend stays where it is.** API routes continue to live in this repo and run on Vercel; the Capacitor app calls them via an absolute `NEXT_PUBLIC_API_BASE` URL (Runbook Phase 0 §4 + Phase 5).
- **`android.useLegacyBridge: true`** in `capacitor.config.ts` — REQUIRED to stop Android killing updates after 5 minutes (plugin issue #89, Runbook Phase 1).
- **CapacitorHttp must be enabled** — `plugins: { CapacitorHttp: { enabled: true } }`. Without it Android throttles WebView HTTP after 5 minutes background and uploads silently die (Runbook Phase 2 "Native HTTP").
- **No raw card/bank data, no PII in logs.** This project does not handle payments, but the same hygiene applies: never log lat/lng with the technician name in production logs.
- **Idempotency by stable UUID.** Every ping carries a `clientPingId`; the server upserts on it. Re-sent pings must be ignored, not duplicated (Runbook Phase 3 + Phase 5 "Upsert on `client_ping_id`").
- **Return HTTP 2xx only after the rows are persisted.** Do not 2xx before the DB write — that is what makes the client safe to drop the queue (Runbook Phase 5).
- **Persistent foreground notification on Android is mandatory and cannot be hidden** — copy must be technician-appropriate (Runbook Phase 2).
- **iOS requires "Always Allow" location.** "While Using" is not enough; the OS suspends background updates otherwise (Runbook Phase 2).
- **Test on real devices for every acceptance step.** Simulators do not exercise the background path correctly (Runbook Phase 7).
- **Field naming:** `camelCase` in TypeScript and API JSON, `snake_case` in Postgres columns. The API layer converts.
- **One UUID library:** use `uuid` (v4) on the client. Do not introduce a second.

---

## File Structure

**New files (root):**
- `capacitor.config.ts` — Capacitor app config; pins app id, web dir, Android legacy bridge, CapacitorHttp.
- `.env.capacitor` — local env file used only by the Capacitor build, sets `NEXT_PUBLIC_API_BASE` and `NEXT_PUBLIC_BUILD_TARGET=capacitor`.

**New files (`lib/`):**
- `lib/api.ts` — single source of the API base URL; `apiUrl(path)` returns `${NEXT_PUBLIC_API_BASE || ''}${path}`.
- `lib/runtime.ts` — `isNative()` detector wrapping `Capacitor.isNativePlatform()` with a safe web fallback.
- `lib/queue-native.ts` — durable queue backed by `@capacitor/preferences`, same shape as `lib/queue.ts`.
- `lib/tracker.ts` — unified tracker: chooses native watcher vs `navigator.geolocation`, chooses native queue vs IndexedDB queue, owns the flush loop. `app/track/page.tsx` only talks to this module.

**Modified files:**
- `package.json` — add Capacitor 7 deps, `@capacitor-community/background-geolocation`, `@capacitor/preferences`, `@capacitor/network`, `uuid`, and a `build:capacitor` script.
- `next.config.mjs` — conditional `output: 'export'` when `BUILD_TARGET=capacitor`; `images: { unoptimized: true }` for the export.
- `lib/types.ts` — add `clientPingId: string` to `TrackPoint`.
- `lib/queue.ts` — accept the new `clientPingId` field (no behavioral change to IndexedDB shape).
- `app/track/page.tsx` — replace inline `watchPosition` + queue calls with `tracker.start(...)` / `tracker.stop(...)` from `lib/tracker.ts`; replace `fetch('/api/...')` calls with `fetch(apiUrl('/api/...'))`.
- `app/api/location/route.ts` — accept `clientPingId` per point; upsert on a unique index to drop duplicates from retries.
- `db/schema.sql` — add `client_ping_id uuid` column on `locations` with a partial unique index per trip; safe migration via `ADD COLUMN IF NOT EXISTS`.

**Native files (generated by `cap add`, then edited):**
- `android/app/src/main/AndroidManifest.xml` — add background location, foreground service, notifications, wake lock permissions.
- `android/app/src/main/res/values/strings.xml` — notification channel name + icon resource name.
- `ios/App/App/Info.plist` — `NSLocation*` strings and `UIBackgroundModes: [location]`.

This plan does not introduce a test framework — the existing repo has none. Acceptance for each phase is a documented manual verification step on a real device, mirroring the runbook's structure.

---

### Task 1: Lock dependencies and project-wide config

**Files:**
- Modify: `package.json`
- Create: `.env.capacitor`
- Modify: `next.config.mjs`

**Interfaces:**
- Consumes: nothing (entry point).
- Produces:
  - npm script `build:capacitor` that runs `cross-env BUILD_TARGET=capacitor next build` and produces `out/`.
  - Environment contract: when `BUILD_TARGET=capacitor`, `next.config.mjs` sets `output: 'export'` and `images.unoptimized: true`.
  - `process.env.NEXT_PUBLIC_API_BASE` is the absolute URL of the Vercel deployment (e.g. `https://mccarthy-gps.vercel.app`) when building for Capacitor; empty string otherwise.

- [ ] **Step 1: Add Capacitor 7 + plugin + queue + uuid dependencies**

Run from the repo root:

```bash
npm i @capacitor/core@^7 @capacitor/android@^7 @capacitor/ios@^7 \
      @capacitor-community/background-geolocation \
      @capacitor/preferences @capacitor/network \
      uuid
npm i -D @capacitor/cli@^7 cross-env @types/uuid
```

Verify they landed at v7:

```bash
node -p "require('./package.json').dependencies['@capacitor/core']"
```

Expected: a string starting with `^7.` or `7.`.

- [ ] **Step 2: Add the `build:capacitor` script**

Edit `package.json` → `scripts` to add:

```json
"build:capacitor": "cross-env BUILD_TARGET=capacitor next build",
"cap:sync": "npm run build:capacitor && npx cap sync"
```

- [ ] **Step 3: Create `.env.capacitor`**

Create `.env.capacitor` (root) with:

```
NEXT_PUBLIC_API_BASE=https://REPLACE-ME.vercel.app
NEXT_PUBLIC_BUILD_TARGET=capacitor
```

Note the value will be overridden per-developer; commit a placeholder and add `.env.capacitor.local` to `.gitignore` if a dev needs a different URL.

- [ ] **Step 4: Conditional static export in `next.config.mjs`**

Replace the entire contents of `next.config.mjs` with:

```js
/** @type {import('next').NextConfig} */
const isCapacitor = process.env.BUILD_TARGET === 'capacitor';

const nextConfig = {
  reactStrictMode: true,
  ...(isCapacitor
    ? {
        output: 'export',
        images: { unoptimized: true },
        trailingSlash: true,
      }
    : {}),
};

export default nextConfig;
```

- [ ] **Step 5: Verify the static export builds**

```bash
npm run build:capacitor
```

Expected: command exits 0 and an `out/` directory appears containing `track/index.html` and `_next/` assets.

If `next build` errors because of an API route or `dynamic = 'force-dynamic'` page, **do not** delete the API routes — they must keep running on Vercel. Instead the static exporter will already skip `app/api/*` by design. Server-only `dynamic` directives are fine because no API page is rendered into `out/`. If the dispatch page errors on export, exclude it from the Capacitor build by giving it `export const dynamic = 'force-static'` — but only if export actually fails on it; do not pre-emptively change it.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json next.config.mjs .env.capacitor
git commit -m "chore(capacitor): pin Capacitor 7 deps, add build:capacitor static export"
```

---

### Task 2: Initialise the Capacitor shell

**Files:**
- Create: `capacitor.config.ts`
- Create (via CLI): `android/`, `ios/` platform folders.

**Interfaces:**
- Consumes: `out/` from Task 1's `build:capacitor`.
- Produces:
  - `npx cap sync` succeeds and copies `out/` into both platform folders.
  - `npx cap open android` launches Android Studio with a project that builds.

- [ ] **Step 1: Write `capacitor.config.ts`**

Create `capacitor.config.ts` (root):

```ts
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mccarthy.fso',
  appName: 'McCarthy FSO',
  webDir: 'out',
  server: { androidScheme: 'https' },
  android: {
    useLegacyBridge: true,
  },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
```

- [ ] **Step 2: Initialise Capacitor**

```bash
npx cap init "McCarthy FSO" com.mccarthy.fso --web-dir=out
```

If this prompts because `capacitor.config.ts` already exists, accept "overwrite" only if it would preserve the file you just wrote — otherwise skip and trust the file from Step 1.

- [ ] **Step 3: Build the web assets**

```bash
npm run build:capacitor
```

Expected: `out/` exists at the repo root.

- [ ] **Step 4: Add Android and iOS platforms**

```bash
npx cap add android
npx cap add ios
```

If you do not have a Mac, skip `cap add ios` for now and continue with Android only — the iOS pieces are isolated in Task 4 anyway.

- [ ] **Step 5: Copy assets and verify sync**

```bash
npx cap sync
```

Expected output ends with `✔ Sync finished` and lists `@capacitor-community/background-geolocation` under "Found N Capacitor plugins".

- [ ] **Step 6: Acceptance — UI loads inside the shell on a real Android device**

```bash
npx cap open android
```

In Android Studio: pick a real connected device (USB debugging on), press Run. The McCarthy Tyre `/track` UI must render. Tap "Start trip" without entering anything — expect the existing form-validation error ("Enter the technician / driver name first."). This proves the bundled web app is loading.

If the UI does not load and the WebView shows a blank page, check `android/app/src/main/assets/public/` exists and contains an `index.html` (it should redirect to `/track/`).

- [ ] **Step 7: Commit**

```bash
git add capacitor.config.ts android/ ios/
git commit -m "feat(capacitor): scaffold native shell (Android + iOS), wire Capacitor 7"
```

---

### Task 3: Android permissions, notification channel, and runtime grants

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/res/values/strings.xml`

**Interfaces:**
- Consumes: Task 2 (an Android Studio project that builds).
- Produces: an APK that, on first run, can ask for `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, and `POST_NOTIFICATIONS` and can show a foreground-service notification while tracking.

- [ ] **Step 1: Add the permissions block to `AndroidManifest.xml`**

Open `android/app/src/main/AndroidManifest.xml`. Inside `<manifest>` (sibling of `<application>`), add (do not duplicate any that already exist):

```xml
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
```

- [ ] **Step 2: Name the notification channel**

Open `android/app/src/main/res/values/strings.xml`. Add (inside `<resources>`):

```xml
<string name="capacitor_background_geolocation_notification_channel_name">Trip tracking</string>
```

Skip the `capacitor_background_geolocation_notification_icon` line for now — adding it without a matching `res/drawable/ic_tracking.png` will fail the build. Add the icon and the string together in a later visual-polish pass.

- [ ] **Step 3: Rebuild and re-run on the device**

```bash
npx cap sync android
npx cap open android
```

Re-run on the device from Android Studio. Confirm the app still loads and shows the `/track` UI.

- [ ] **Step 4: Acceptance — permission prompts**

Tap "Start trip" with a driver name filled in. The app will only get as far as today's browser flow (`navigator.geolocation`) at this point because the native tracker is not wired yet. That is expected — we will replace the watcher in Task 5. For now, confirm only that the app does not crash on launch and the manifest builds.

- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/AndroidManifest.xml android/app/src/main/res/values/strings.xml
git commit -m "feat(android): declare background location + notification permissions"
```

---

### Task 4: iOS Info.plist + background mode

**Files:**
- Modify: `ios/App/App/Info.plist`

**Interfaces:**
- Consumes: Task 2 (an Xcode project that builds).
- Produces: an iOS build that prompts for "Always Allow" location and that keeps running in the background under the `location` UIBackgroundMode.

Skip this entire task if you are Android-only for now.

- [ ] **Step 1: Add the location usage strings**

Open `ios/App/App/Info.plist`. Inside the top-level `<dict>`, add (do not duplicate keys that already exist):

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

- [ ] **Step 2: Open Xcode and run on a real iPhone**

```bash
npx cap sync ios
npx cap open ios
```

In Xcode: select your team for signing (Signing & Capabilities → Team), pick the connected iPhone, press Run. On the phone, when the OS prompts "Allow … to use your location?", pick **"Allow While Using App"** for now — the upgrade to "Always" happens later, after backgrounding while a watcher is active (this is Apple's design).

- [ ] **Step 3: Acceptance**

The app launches on the iPhone and shows the `/track` UI. No crash, no missing-plist-key error in the Xcode console.

- [ ] **Step 4: Commit**

```bash
git add ios/App/App/Info.plist
git commit -m "feat(ios): declare location usage strings and background mode"
```

---

### Task 5: Runtime detection and API base helper

**Files:**
- Create: `lib/runtime.ts`
- Create: `lib/api.ts`

**Interfaces:**
- Consumes: `@capacitor/core` (installed in Task 1), `process.env.NEXT_PUBLIC_API_BASE` (from `.env.capacitor`).
- Produces:
  - `isNative(): boolean` — true only when running inside the Capacitor WebView.
  - `apiUrl(path: string): string` — prefixes `path` with `NEXT_PUBLIC_API_BASE` when set, returns `path` unchanged otherwise.

These two helpers are how every other piece of code decides "am I a phone build or a Vercel browser build?". Keep them tiny and pure.

- [ ] **Step 1: Write `lib/runtime.ts`**

Create `lib/runtime.ts`:

```ts
import { Capacitor } from '@capacitor/core';

/** True when running inside the Capacitor native WebView (iOS or Android). */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Write `lib/api.ts`**

Create `lib/api.ts`:

```ts
const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** Build an absolute API URL for native builds, a relative one for the Vercel browser build. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return BASE + path;
}
```

- [ ] **Step 3: Verify the regular Vercel build still passes**

```bash
npm run build
```

Expected: build succeeds. (We have not yet changed any callers — this is just a safety check that the new modules compile.)

- [ ] **Step 4: Commit**

```bash
git add lib/runtime.ts lib/api.ts
git commit -m "feat(lib): add runtime.isNative() and api.apiUrl() helpers"
```

---

### Task 6: Native durable queue (Preferences-backed)

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/queue.ts`
- Create: `lib/queue-native.ts`

**Interfaces:**
- Consumes: `@capacitor/preferences` (installed in Task 1).
- Produces (same shape as `lib/queue.ts` so callers don't care which is used):
  - `enqueue(point: TrackPoint): Promise<void>`
  - `peekBatch(limit?: number): Promise<{ key: string; point: TrackPoint }[]>`
  - `removeKeys(keys: string[]): Promise<void>`
  - `queueCount(): Promise<number>`
- Updated `TrackPoint` shape (used by both queues and the API):

  ```ts
  export interface TrackPoint {
    clientPingId: string;     // NEW — stable UUID per ping, generated at capture
    lat: number;
    lng: number;
    accuracy?: number | null;
    recordedAt: string;
  }
  ```

- [ ] **Step 1: Add `clientPingId` to `TrackPoint`**

Edit `lib/types.ts`. Change the `TrackPoint` interface to:

```ts
export interface TrackPoint {
  /** Stable UUID stamped at capture; the server upserts on it so retries are safe. */
  clientPingId: string;
  lat: number;
  lng: number;
  accuracy?: number | null;
  /** ISO timestamp of when the reading was captured on the device */
  recordedAt: string;
}
```

- [ ] **Step 2: Sanity-check `lib/queue.ts`**

Read `lib/queue.ts`. The existing IndexedDB queue stores arbitrary `TrackPoint` objects via `keyPath: 'id', autoIncrement: true`. The new `clientPingId` field is just an extra property — no schema migration of the existing object store is required. Leave `lib/queue.ts` unchanged.

- [ ] **Step 3: Write `lib/queue-native.ts`**

Create `lib/queue-native.ts`:

```ts
'use client';
import { Preferences } from '@capacitor/preferences';
import type { TrackPoint } from './types';

const KEY = 'mc_ping_queue_v1';

interface Entry { key: string; point: TrackPoint }

async function load(): Promise<Entry[]> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return [];
  try { return JSON.parse(value) as Entry[]; }
  catch { return []; }
}

async function save(entries: Entry[]): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(entries) });
}

export async function enqueue(point: TrackPoint): Promise<void> {
  const entries = await load();
  entries.push({ key: point.clientPingId, point });
  await save(entries);
}

export async function peekBatch(
  limit = 200
): Promise<{ key: string; point: TrackPoint }[]> {
  const entries = await load();
  return entries.slice(0, limit);
}

export async function removeKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const set = new Set(keys);
  const entries = await load();
  const filtered = entries.filter(e => !set.has(e.key));
  await save(filtered);
}

export async function queueCount(): Promise<number> {
  const entries = await load();
  return entries.length;
}
```

Note: keys are strings here (the `clientPingId`) while `lib/queue.ts` returns `IDBValidKey`. Callers in `lib/tracker.ts` (next task) will normalise both into a `string | IDBValidKey` union — we do not refactor `lib/queue.ts` to match because that risks breaking the live browser path.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. If TS complains that `app/track/page.tsx` is missing `clientPingId` when calling `enqueue`, that is expected — Task 7 fixes it.

If you want a green type-check between tasks, temporarily wrap `lib/queue.ts`'s `enqueue` to inject a UUID when the caller omits one. Otherwise just move on to Task 7 immediately.

- [ ] **Step 5: Commit**

```bash
git add lib/types.ts lib/queue-native.ts
git commit -m "feat(queue): add clientPingId on TrackPoint, add Preferences-backed native queue"
```

---

### Task 7: The unified tracker (`lib/tracker.ts`)

**Files:**
- Create: `lib/tracker.ts`

**Interfaces:**
- Consumes: `lib/runtime.ts`, `lib/api.ts`, `lib/types.ts`, `lib/queue.ts` (web), `lib/queue-native.ts` (native), `@capacitor-community/background-geolocation`, `@capacitor/network`, `uuid`.
- Produces a small, stable surface that `app/track/page.tsx` calls:
  - `startTracking(opts: { tripId: string; ingestSecret: string; onUpdate: (u: TrackerUpdate) => void }): Promise<void>`
  - `stopTracking(): Promise<void>`
  - `TrackerUpdate` = `{ queued: number; lastSent: string | null; accuracy: number | null; speedMph: number }`

This module is the heart of the Capacitor work. It hides every "am I native or web" branch from the page.

- [ ] **Step 1: Write `lib/tracker.ts` — module skeleton + queue picker**

Create `lib/tracker.ts`:

```ts
'use client';
import { v4 as uuidv4 } from 'uuid';
import { Network } from '@capacitor/network';
import { registerPlugin } from '@capacitor/core';
import { isNative } from './runtime';
import { apiUrl } from './api';
import type { TrackPoint } from './types';

import * as webQueue from './queue';
import * as nativeQueue from './queue-native';

type AnyKey = string | IDBValidKey;
interface QueueLike {
  enqueue(p: TrackPoint): Promise<void>;
  peekBatch(limit?: number): Promise<{ key: AnyKey; point: TrackPoint }[]>;
  removeKeys(keys: AnyKey[]): Promise<void>;
  queueCount(): Promise<number>;
}

const queue: QueueLike = (isNative() ? nativeQueue : webQueue) as unknown as QueueLike;

export interface TrackerUpdate {
  queued: number;
  lastSent: string | null;
  accuracy: number | null;
  speedMph: number;
}
```

- [ ] **Step 2: Add the native plugin handle and the flush loop**

Append to `lib/tracker.ts`:

```ts
interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  bearing: number | null;
  time: number;
}
interface BgWatcherOptions {
  backgroundTitle?: string;
  backgroundMessage?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    opts: BgWatcherOptions,
    cb: (loc: BgLocation | null, err?: { code: string; message: string }) => void
  ): Promise<string>;
  removeWatcher(opts: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = isNative()
  ? registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
  : null;

let tripId: string | null = null;
let ingestSecret = '';
let watcherId: string | null = null;
let webWatchId: number | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let lastSent: string | null = null;
let onUpdate: ((u: TrackerUpdate) => void) | null = null;
let lastAccuracy: number | null = null;
let lastSpeedMph = 0;

async function emit() {
  if (!onUpdate) return;
  onUpdate({
    queued: await queue.queueCount(),
    lastSent,
    accuracy: lastAccuracy,
    speedMph: lastSpeedMph,
  });
}

async function flush() {
  if (flushing || !tripId) return;
  flushing = true;
  try {
    if (isNative()) {
      const status = await Network.getStatus();
      if (!status.connected) return;
    }
    let batch = await queue.peekBatch(200);
    while (batch.length) {
      const points = batch.map(b => b.point);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ingestSecret) headers['x-ingest-secret'] = ingestSecret;
      const res = await fetch(apiUrl('/api/location'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripId, points }),
      });
      if (res.status < 200 || res.status >= 300) break;
      await queue.removeKeys(batch.map(b => b.key));
      lastSent = new Date().toLocaleTimeString();
      batch = await queue.peekBatch(200);
    }
  } catch {
    /* offline / error — queue stays intact, retried on next trigger */
  } finally {
    flushing = false;
    await emit();
  }
}
```

- [ ] **Step 3: Add `startTracking` and `stopTracking`**

Append to `lib/tracker.ts`:

```ts
export async function startTracking(opts: {
  tripId: string;
  ingestSecret: string;
  onUpdate: (u: TrackerUpdate) => void;
}): Promise<void> {
  tripId = opts.tripId;
  ingestSecret = opts.ingestSecret;
  onUpdate = opts.onUpdate;
  lastSent = null;

  if (isNative() && BackgroundGeolocation) {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Trip active',
        backgroundMessage: 'Sharing your location with dispatch while on a job.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      async (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED' && BackgroundGeolocation) {
            await BackgroundGeolocation.openSettings();
          }
          return;
        }
        if (!loc) return;
        lastAccuracy = Math.round(loc.accuracy);
        if (loc.speed != null && !Number.isNaN(loc.speed)) {
          lastSpeedMph = Math.max(0, Math.round(loc.speed * 2.23694));
        }
        await queue.enqueue({
          clientPingId: uuidv4(),
          lat: loc.latitude,
          lng: loc.longitude,
          accuracy: loc.accuracy,
          recordedAt: new Date(loc.time).toISOString(),
        });
        await emit();
        flush();
      }
    );
  } else {
    webWatchId = navigator.geolocation.watchPosition(
      async pos => {
        lastAccuracy = Math.round(pos.coords.accuracy);
        if (pos.coords.speed != null && !Number.isNaN(pos.coords.speed)) {
          lastSpeedMph = Math.max(0, Math.round(pos.coords.speed * 2.23694));
        }
        await queue.enqueue({
          clientPingId: uuidv4(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          recordedAt: new Date(pos.timestamp).toISOString(),
        });
        await emit();
      },
      () => { /* handled by the page UI */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  flushTimer = setInterval(flush, 20000);
  if (isNative()) {
    Network.addListener('networkStatusChange', s => { if (s.connected) flush(); });
  }
  await emit();
}

export async function stopTracking(): Promise<void> {
  if (watcherId && BackgroundGeolocation) {
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
    watcherId = null;
  }
  if (webWatchId != null) {
    navigator.geolocation.clearWatch(webWatchId);
    webWatchId = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
  tripId = null;
  onUpdate = null;
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: 0 errors. The `IDBValidKey | string` union behind the `QueueLike` cast is deliberately loose; the runtime branch guarantees only one queue is in use at a time.

- [ ] **Step 5: Commit**

```bash
git add lib/tracker.ts
git commit -m "feat(tracker): unified web/native tracker with durable queue + flush loop"
```

---

### Task 8: Rewire `app/track/page.tsx` onto the tracker

**Files:**
- Modify: `app/track/page.tsx`

**Interfaces:**
- Consumes: `lib/tracker.ts`, `lib/api.ts`.
- Produces: a `/track` page whose only change is that it delegates to `tracker.startTracking` / `tracker.stopTracking`, and prefixes every `fetch('/api/...')` with `apiUrl(...)`. UX, copy, and form fields are identical to today.

- [ ] **Step 1: Replace the imports block**

In `app/track/page.tsx`, change:

```ts
import { enqueue, peekBatch, removeKeys, queueCount } from '@/lib/queue';
```

to:

```ts
import { startTracking, stopTracking, type TrackerUpdate } from '@/lib/tracker';
import { apiUrl } from '@/lib/api';
```

- [ ] **Step 2: Delete the now-dead state and refs**

In `app/track/page.tsx`, delete:
- The `flushTimer` ref.
- The `watchIdRef` ref.
- The `onPosition` `useCallback`.
- The `onGeoError` `useCallback`.
- The entire `flush` `useCallback`.

Keep `wakeLockRef`, `tripIdRef`, `lastFixAt`, all `useState` calls, and all rendering — those still drive the UI.

- [ ] **Step 3: Replace the `start()` body with tracker calls**

In `app/track/page.tsx`, in the `start()` async function, after `tripIdRef.current = data.tripId;` and `setBusy(false)`, replace the block that currently sets up `navigator.geolocation.watchPosition(...)` and `setInterval(flush, FLUSH_MS)` with:

```ts
setPhase('tracking');
setDistanceMi(0);
lastFixAt.current = Date.now();
await requestWakeLock();

await startTracking({
  tripId: data.tripId,
  ingestSecret: secret,
  onUpdate: (u: TrackerUpdate) => {
    setQueued(u.queued);
    if (u.lastSent) setLastSent(u.lastSent);
    if (u.accuracy != null) setAccuracy(u.accuracy);
    setSpeedMph(u.speedMph);
    lastFixAt.current = Date.now();
    setPhase(p => (p === 'lost' ? 'tracking' : p));
  },
});
```

- [ ] **Step 4: Replace the `stop()` body**

In `app/track/page.tsx`, replace the `stop()` body with:

```ts
async function stop() {
  await stopTracking();
  const tripId = tripIdRef.current;
  if (tripId) {
    await fetch(apiUrl('/api/trips/end'), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ tripId }),
    }).catch(() => {});
  }
  try { await wakeLockRef.current?.release?.(); } catch {}
  wakeLockRef.current = null;
  tripIdRef.current = null;
  setPhase('ended');
}
```

- [ ] **Step 5: Prefix the remaining fetches**

Find the call `await fetch('/api/trips/start', { … })` in `start()` and change it to `await fetch(apiUrl('/api/trips/start'), { … })`. There are no other `/api/*` calls left in this file once Steps 2–4 are done.

- [ ] **Step 6: Verify the Vercel browser build still works**

```bash
npm run dev
```

Open `http://localhost:3000/track`. Fill in a driver name, tap "Start trip", allow location. Confirm the existing browser flow still records, the queued counter still ticks down, and distance still updates on the screen. This proves the abstraction did not break the web path.

- [ ] **Step 7: Commit**

```bash
git add app/track/page.tsx
git commit -m "refactor(track): delegate watch + queue + flush to lib/tracker (web parity)"
```

---

### Task 9: Server-side idempotency on `/api/location`

**Files:**
- Modify: `db/schema.sql`
- Modify: `app/api/location/route.ts`

**Interfaces:**
- Consumes: `clientPingId` arriving in every point.
- Produces: a `/api/location` endpoint that drops re-sent points silently and never double-counts distance on a retry.

This is the change that makes the offline back-fill safe (Runbook Phase 5).

- [ ] **Step 1: Add the `client_ping_id` column + uniqueness**

Edit `db/schema.sql`. After the existing `CREATE INDEX IF NOT EXISTS idx_locations_trip_time …` line, append:

```sql
-- Idempotency: each point carries a client-generated UUID. Retries must be ignored, not duplicated.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS client_ping_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_trip_clientping
  ON locations (trip_id, client_ping_id)
  WHERE client_ping_id IS NOT NULL;
```

The `WHERE` clause makes the index partial so existing rows with `NULL` do not block the migration.

- [ ] **Step 2: Apply the migration to Neon**

```bash
npm run db:setup
```

Expected output: `setup-db.mjs` reports success and the `ALTER TABLE` + `CREATE UNIQUE INDEX` complete without error. (`scripts/setup-db.mjs` runs the whole schema file; `IF NOT EXISTS` guards make this idempotent.)

- [ ] **Step 3: Dedupe inside `/api/location/route.ts`**

Open `app/api/location/route.ts`. Replace the `INSERT INTO locations` statement inside the `for (const p of sorted)` loop with:

```ts
const inserted = await sql`
  INSERT INTO locations (trip_id, lat, lng, accuracy_m, recorded_at, is_gap, client_ping_id)
  VALUES (${tripId}, ${lat}, ${lng}, ${acc}, ${new Date(t).toISOString()}, ${isGap}, ${p.clientPingId ?? null})
  ON CONFLICT (trip_id, client_ping_id) WHERE client_ping_id IS NOT NULL DO NOTHING
  RETURNING id`;
if (inserted.length === 0) {
  // duplicate retry — undo the distance accumulation we just added
  if (isGap) estimated -= prevLat != null && prevLng != null ? haversineMeters(prevLat, prevLng, lat, lng) : 0;
  else        measured -= prevLat != null && prevLng != null ? haversineMeters(prevLat, prevLng, lat, lng) : 0;
  continue; // do not advance prevLat/prevLng/prevTime — the duplicate isn't the new "previous"
}
```

This requires `haversineMeters` to already be imported (it is, at the top of the file). Note we recompute the same distance we just added so we can subtract it cleanly — there is no other safe way without rearranging the loop.

- [ ] **Step 4: Verify**

```bash
npm run dev
```

In a second terminal, POST the same payload twice with the same `clientPingId`:

```bash
curl -X POST http://localhost:3000/api/location \
  -H 'Content-Type: application/json' \
  -d '{"tripId":"<a real active trip id>","points":[{"clientPingId":"11111111-1111-1111-1111-111111111111","lat":40.7,"lng":-74.0,"accuracy":10,"recordedAt":"2026-06-26T12:00:00Z"}]}'
```

Run it twice. First call: `distanceTotalM` reflects 1 point inserted. Second call: response body still reports `accepted: 1` but the DB row count for that trip has not changed and `distanceTotalM` is unchanged. Verify with:

```bash
psql "$DATABASE_URL" -c "SELECT count(*) FROM locations WHERE trip_id = '<that trip id>';"
```

Expected: 1, not 2.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql app/api/location/route.ts
git commit -m "feat(api): upsert locations on client_ping_id to make retries safe"
```

---

### Task 10: Field test — background, screen-off, airplane mode (Android)

**Files:** none — this is the integrated acceptance run.

**Interfaces:** none.

This task is the runbook's Phase 7. It is the only proof that the system actually does what the goal sentence claims.

- [ ] **Step 1: Build a fresh debug APK**

```bash
npm run cap:sync
npx cap open android
```

Press Run in Android Studio to install on a real, signal-having Android phone. Make sure the Vercel deployment is up at the URL you set in `.env.capacitor` (Task 1).

- [ ] **Step 2: Background tracking**

On the phone, open the app, enter a driver name + dest, tap "Start trip". When prompted, grant **Allow all the time** for location and **Allow** for notifications. Confirm the persistent "Trip tracking" notification appears.

Lock the screen. Put the phone in a pocket. Walk or drive for 5+ minutes.

On a laptop, open `https://<your-vercel-url>/dispatch`. Expected: a marker for your driver moves; distance ticks up.

- [ ] **Step 3: Offline gap back-fill**

Without ending the trip, turn on airplane mode for 3 minutes while still moving. The on-phone "queued" counter should rise. Turn airplane mode off.

Expected within ~30 seconds: the queued counter drops to zero and the dispatcher map fills in the missing positions with the real coordinates that were captured during the outage, not a straight line. There must be no duplicate points (look for `distance_measured_m` looking sane — eyeball-check against the actual drive).

- [ ] **Step 4: End and reconcile**

Tap "End trip". The trip status flips to `ended` in Postgres:

```bash
psql "$DATABASE_URL" -c "SELECT id, status, distance_measured_m, distance_estimated_m FROM trips ORDER BY started_at DESC LIMIT 1;"
```

Expected: `status = 'ended'`, `distance_measured_m` matches the rough distance of the actual route to within a few percent.

- [ ] **Step 5: Document the result**

Append a one-paragraph log entry to `docs/superpowers/plans/2026-06-26-capacitor-background-tracking.md` (this file) under a new "Field test log" heading: device model, Android version, distance walked/driven, queued count peak, any anomalies. This is the artifact that closes the task; do not skip it.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-06-26-capacitor-background-tracking.md
git commit -m "docs(plan): record Android field test results for background tracking"
```

---

### Task 11: Field test — iOS

**Files:** none — acceptance run on iPhone.

Skip this task if you are Android-only for now.

- [ ] **Step 1: Build a fresh iOS debug build**

```bash
npm run cap:sync
npx cap open ios
```

Pick the connected iPhone in Xcode, press Run.

- [ ] **Step 2: Upgrade location to "Always"**

On first watch start, iOS will prompt for location with only "While Using" and "Allow Once" choices. Pick "While Using". Background the app. Lock the screen for ~30 seconds. Re-open the app. iOS now prompts to upgrade to "Always Allow" — accept it. (This sequence is iOS design, not something you can shortcut.)

- [ ] **Step 3: Run Steps 2–4 from Task 10 on iPhone**

Confirm the same three outcomes: background tracking works, airplane-mode gap back-fills, total distance is sane.

- [ ] **Step 4: Document and commit**

Append the iOS field test paragraph alongside the Android one. Commit.

---

### Task 12: Release-build prep

**Files:**
- Modify: `.gitignore` (add `out/`, `android/app/build/`, `ios/build/` if not already ignored).
- Modify: README — short "Capacitor build" section pointing here.

**Interfaces:** none — this is the operational closure of the work.

- [ ] **Step 1: Add a "Capacitor build" section to `README.md`**

Append to `README.md`:

```markdown
## Capacitor (background tracking) build

The same code base also ships as a native Android/iOS shell so the technician's
location is recorded with the screen off. See
`docs/superpowers/plans/2026-06-26-capacitor-background-tracking.md` for the full
build and field-test procedure.

Quick start:

```bash
npm run cap:sync         # build out/, copy into native projects
npx cap open android     # then Run from Android Studio onto a real device
npx cap open ios         # then Run from Xcode onto a real iPhone
```

The Capacitor build talks to the **same Vercel API** as the browser app — set
`NEXT_PUBLIC_API_BASE` in `.env.capacitor` before building.
```

- [ ] **Step 2: Confirm `.gitignore`**

Make sure these are in `.gitignore` (add any that are missing):

```
out/
android/app/build/
android/build/
android/.gradle/
ios/App/build/
ios/Pods/
```

Do not gitignore the `android/` and `ios/` directories themselves — those contain hand-edited manifests from Tasks 3 and 4 and must be tracked.

- [ ] **Step 3: Commit**

```bash
git add README.md .gitignore
git commit -m "docs: capacitor build steps; ignore native build artefacts"
```

---

## Phase 2 deferred: switching to the paid Transistorsoft plugin

Out of scope for this plan, but if a later decision swaps the free plugin for `@transistorsoft/capacitor-background-geolocation`:
- Delete `lib/queue-native.ts` and the queue plumbing in `lib/tracker.ts` — Transistorsoft's internal SQLite + `autoSync` replaces it.
- Replace `addWatcher`/`removeWatcher` with `ready()` + `start()/stop()` and use `setConfig({ extras: { tripId, technicianId, eventId } })`.
- Keep `db/schema.sql` and `app/api/location/route.ts` as-is — server-side idempotency is still correct.
- The $399 Android licence is only needed for release builds; debug works free.

---

## Self-review notes

- Spec coverage:
  - Runbook Phase 0 → Task 1 (deps, env, conditional export) + Global Constraints.
  - Runbook Phase 1 → Task 2 (shell, platforms, sync, `useLegacyBridge`, `CapacitorHttp`).
  - Runbook Phase 2 → Tasks 3 (Android perms) + 4 (iOS Info.plist).
  - Runbook Phase 3 (the offline queue) → Tasks 6 (queue) + 7 (tracker flush loop, Network listener, 20s timer).
  - Runbook Phase 4 (trip lifecycle) → Task 8 (page rewires onto `startTracking`/`stopTracking`).
  - Runbook Phase 5 (backend ingest + idempotency) → Task 9 (schema + dedupe).
  - Runbook Phase 6 (dispatcher SSE) → already implemented in the existing `/dispatch` page; nothing to do.
  - Runbook Phase 7 (end-to-end) → Tasks 10 (Android) + 11 (iOS).
  - Runbook Phase 8 (release) → Task 12.
- The plan deliberately does NOT change the payload shape to the "spec's" `{ location: [{uuid, timestamp, coords, extras}] }`. The existing endpoint uses `{ tripId, points: [...] }` and switching the wire format would mean rewriting `/api/location` and `/dispatch`. Idempotency is the load-bearing requirement, not the envelope shape — Task 9 delivers that without churn.
- Type consistency check: `TrackPoint` adds `clientPingId: string`; every call site (`queue.enqueue` in `lib/tracker.ts`, the curl in Task 9 Step 4, the SQL in Task 9 Step 3) uses the same field name.
- The IndexedDB queue is intentionally left in place for the browser build — deleting it would mean either ripping the Vercel `/track` path or porting Preferences to the browser. Both are unnecessary; the runtime branch in `lib/tracker.ts` is the simpler choice.
