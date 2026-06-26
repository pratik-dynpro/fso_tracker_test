# Business Requirements Document (BRD)
## Field Technician Live GPS Tracking — IoT Telemetry Platform

---

### Document Control

| Field | Value |
|---|---|
| Document title | Field Technician Live GPS Tracking — IoT Telemetry Platform |
| Project / Program | FSO — Technician GPS Tracking |
| Client / Business unit | McCarthy Tyre Services |
| Prepared by | Shashikant |
| Date | 24 Jun 2026 |
| Version | 1.0 (Draft for review) |
| Status | For review |
| Related documents | Technician-GPS-Tracking-Proposal.html; Implementation-Plan-Vercel.md |

**Revision history**

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 24 Jun 2026 | Shashikant | Initial BRD consolidating proposal, Vercel test plan, and gap-fill strategy |

---

## 1. Executive Summary

McCarthy Tyre Services dispatches field technicians to roadside tyre breakdowns. Today, once a technician leaves, dispatch has no visibility into their location until the technician phones in. This BRD defines the business requirements for an **IoT-style location telemetry platform** in which each technician's **existing smartphone acts as a connected edge device (GPS sensor node)**, streaming position telemetry to a cloud backend that powers a **live dispatch map** and **automatic per-job distance measurement**.

The solution is delivered as a lightweight tracker embedded in the web app technicians already use — **no hardware to buy, no native app to install** for the initial release. It is designed to keep recording through mobile dead zones (edge buffering) and to **estimate position during device-off gaps** using a known job destination and road-routing (dead reckoning).

A test deployment will be hosted on **Vercel** with a **Neon PostgreSQL** database and **Google Maps**, suitable for validating the concept with a single driver before any production rollout.

---

## 2. Business Objectives

| # | Objective | Business value |
|---|---|---|
| BO-1 | Provide dispatch real-time visibility of every technician's location | Faster, informed dispatch decisions |
| BO-2 | Enable accurate ETAs to waiting customers | Improved customer experience |
| BO-3 | Dispatch the nearest available technician to a new call | Lower response time, reduced fuel/cost |
| BO-4 | Automatically confirm arrival and on-site time per job | Reduced reliance on manual phone-ins |
| BO-5 | Automatically capture distance driven per job | Accurate cost recovery / billing inputs |
| BO-6 | Achieve the above at low cost using existing devices | Minimal capital outlay, fast time-to-value |

---

## 3. Background & Problem Statement

Technicians drive to roadside breakdowns to repair and replace tyres (e.g., service event `07885993`, a trailer tyre job off I-95, New Jersey). From departure until the technician calls in, dispatch is **blind**. Consequences:

- **No live position or ETA** — cannot tell a waiting customer when help arrives.
- **Cannot dispatch the nearest technician** — assignment is guesswork.
- **No confirmation of arrival / on-site time** — relies on manual calls.
- **No automatic distance record per job** — mileage is not captured.

The business needs a **live map of every technician** that keeps recording through poor-signal areas and **measures distance for each job automatically**.

---

## 4. IoT Solution Overview

The solution follows a standard IoT telemetry pattern, mapped to this use case:

| IoT layer | In this solution |
|---|---|
| **Edge device / sensor node** | Technician's smartphone running the existing web app; on-board GPS is the sensor |
| **Edge buffering** | Browser IndexedDB queues readings when offline; flushes on reconnect |
| **Connectivity / ingestion** | HTTPS POST of location telemetry to cloud serverless endpoints every ~10–15s, batched on reconnect |
| **Cloud processing** | Backend validates each reading, persists it, maintains a running per-job distance, and estimates gaps |
| **Data store** | PostgreSQL (Neon) — devices/trips/locations and distance metrics |
| **Application / visualization** | Dispatch live map (Google Maps) polling latest positions |

**Telemetry flow:** Capture (phone GPS) → Buffer (IndexedDB if offline) → Send (HTTPS batch) → Store & process (cloud + DB) → Display (dispatch map).

---

## 5. Scope

### 5.1 In Scope (Release 1 — Test)
- Browser-based GPS capture inside the existing technician web app.
- Edge buffering of readings during network outage and flush on reconnect.
- Cloud ingestion endpoints and persistence of all location telemetry.
- Automatic distance calculation per job/trip (haversine from the recorded track).
- Live dispatch map showing each active technician as a marker (polling-based updates).
- **Gap handling** for device-off periods: detection, honest rendering, and **destination-based dead-reckoning estimate** with two-phase backfill (see Section 7.3).
- Test hosting on Vercel; Neon PostgreSQL; Google Maps; HTTPS.

### 5.2 Out of Scope (Deferred)
- Native mobile app for tracking while the phone is **locked/pocketed** (candidate upgrade via Capacitor wrapper).
- Dedicated in-vehicle GPS hardware.
- PostGIS spatial extension (haversine used instead for the test).
- Real-time push streaming (SSE/WebSocket); polling used in the test.
- Full authentication / per-technician accounts; geofencing for automatic arrival detection.
- Production-grade scaling, monitoring, and data-retention policies.

---

## 6. Stakeholders

| Stakeholder | Role / interest |
|---|---|
| Dispatch team | Primary users of the live map; assign and monitor technicians |
| Field technicians | Edge-device operators; subject to location tracking |
| Operations management | Owns response-time and cost KPIs |
| HR / Legal | Approves staff location tracking and policy (on-shift scope) |
| Engineering | Builds and operates the platform |
| Finance | Owns cloud cost and any billing use of distance data |

---

## 7. Business Requirements

### 7.1 Functional Requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | The technician's web app shall capture GPS position using the device browser, with no native app or added hardware. | Must |
| FR-2 | Position readings shall be sent to the backend approximately every 10–15 seconds. | Must |
| FR-3 | When offline, readings shall be queued on the device and transmitted automatically on reconnect, preserving each reading's original capture timestamp. | Must |
| FR-4 | The backend shall validate and persist every received reading. | Must |
| FR-5 | The system shall maintain a running total distance per job/trip, computed from the recorded track. | Must |
| FR-6 | Dispatch shall view all active technicians as live markers on a Google Map. | Must |
| FR-7 | The map shall refresh technician positions at least every 3–5 seconds. | Must |
| FR-8 | A technician/job session shall be explicitly started and ended (trip lifecycle). | Must |
| FR-9 | Each trip may store a destination (job location) to enable gap estimation. | Should |
| FR-10 | The system shall detect a telemetry gap when the time between consecutive readings exceeds a configurable threshold. | Must |
| FR-11 | For a detected gap with a known destination, the system shall estimate the path and distance using a road-routing service and animate the marker at the route's estimated pace. | Should |
| FR-12 | When the device resumes, the system shall backfill the gap by routing between the last-known and the actual resume point, and recompute the gap distance. | Should |
| FR-13 | Estimated segments shall be visually distinct (e.g., dashed) and their distance flagged as `estimated`, separate from `measured`. | Must |
| FR-14 | A completed trip's full track and total distance shall be viewable for review. | Should |
| FR-15 | The technician page shall keep the screen awake while tracking (Wake Lock) to reduce device-off gaps. | Should |

### 7.2 Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-1 | All communication shall be over HTTPS/TLS (also required for browser geolocation). |
| NFR-2 | The test solution shall run on free or low-cost tiers (target ~$0 for the test; ~$30–70/month at small production scale). |
| NFR-3 | The tracker shall drop into the existing web app with minimal code (~150 lines) regardless of how the app is built. |
| NFR-4 | The system shall remain functional through intermittent connectivity (dead-zone tolerance). |
| NFR-5 | Write endpoints shall be protected by a shared secret for the test (full auth deferred). |
| NFR-6 | Location data handling shall comply with HR/legal sign-off, including whether tracking is on-shift only. |
| NFR-7 | The system shall not silently present estimated data as measured (data integrity / honesty). |

### 7.3 Gap-Handling Requirement (Detail)

Two distinct gap types are recognised:

- **Connection gap** — device kept recording; network was down. Readings exist in the edge buffer and **fill in with real positions** on reconnect. No estimation needed.
- **Device-off gap** — device was locked/suspended and **captured nothing**. The positions cannot be recovered and must be **estimated or prevented**.

For device-off gaps, the required behaviour (per FR-9 to FR-13):

1. **Live (during gap):** with a known destination, route `last-known → destination`, then move the marker along that route at the route's estimated pace; distance for the segment = `progress × route distance`, flagged `estimated`.
2. **Backfill (on resume):** route `last-known → actual resume point` (both real), replace the live estimate, recompute the gap distance.
3. **Fallback (no destination):** dashed straight line with haversine distance, flagged `estimated`.
4. **Prevention:** Wake Lock + dashboard mount (Release 1); native background-geolocation via Capacitor (future) to largely eliminate device-off gaps.

---

## 8. Technical Approach (Test Deployment)

| Layer | Choice |
|---|---|
| Framework / hosting | Next.js (TypeScript) on Vercel; automatic HTTPS |
| Backend | Vercel serverless API routes |
| Database | Neon PostgreSQL (free tier) via serverless driver |
| Distance math | Haversine in code (PostGIS deferred) |
| Live updates | Client polling every 3–5s (streaming deferred) |
| Edge buffer | IndexedDB on the device |
| Map | Google Maps JavaScript API |
| Routing (gap fill) | Google Directions API (free-tier volume for test) |

Data entities: **drivers**, **trips** (with running `distance_meters`, optional `destination_lat/lng`, and `measured` vs `estimated` distance), **locations** (each reading with capture and receive timestamps, plus a gap flag).

---

## 9. Assumptions

- Technicians use a smartphone with a modern browser and location enabled.
- For best results, the device is mounted with the screen on during a job.
- Each roadside job has a known destination available to the system.
- A Google Maps API key with billing and a free-tier allowance is available.
- HR/legal approval for tracking is obtained before production use.

---

## 10. Constraints

- Browser GPS runs only while the page is foreground and the device is unlocked (root cause of device-off gaps).
- Vercel serverless functions are short-lived; no long-held streaming connections in the test.
- Estimated gap data is inherently approximate and must be labelled as such.
- Free-tier limits and serverless cold starts apply to the test environment.

---

## 11. Risks

| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| Frequent device-off gaps (phone locked/pocketed) | Inaccurate live position and distance | Medium | Wake Lock + mount now; Capacitor background tracking later |
| Estimated distance used for billing | Disputes / revenue error | Medium | Separate `measured` vs `estimated`; flag estimates clearly |
| Battery / data drain from continuous GPS | Technician resistance | Medium | Tune reading interval; document expectation |
| Privacy / compliance concerns | Legal exposure | Medium | HR/legal sign-off; on-shift-only option |
| API cost overrun (Maps/Directions) | Unexpected cost | Low | Domain-locked key, daily caps, budget alerts |
| Serverless cold-start latency | Minor UX lag | Low | Acceptable for test; revisit for production |

---

## 12. Success Criteria / KPIs

- Dispatch can see a technician move on the live map within 3–5s of actual movement.
- A completed trip shows a total distance that reasonably matches the route driven (measured + clearly flagged estimated portions).
- Device-off gaps are detected, rendered distinctly, and estimated when a destination is known.
- The tracker is embedded in the existing app with minimal code change.
- Test runs within free-tier cost.

---

## 13. Prerequisites to Proceed ("Green Light")

1. Google Maps API key with billing enabled, domain-locked, with daily caps and a budget alert.
2. An HTTPS web address for the technician page (automatic on Vercel).
3. HR/legal sign-off on tracking technicians, including on-shift scope.
4. Neon database provisioned and connection string available.
5. Engineering build of the database, backend, in-browser tracker, dispatch map, and gap-fill logic.

---

## 14. Glossary

| Term | Meaning |
|---|---|
| Edge device | The technician's smartphone acting as the GPS sensor/telemetry source |
| Telemetry | Location readings (lat, lng, accuracy, timestamp) sent from the device |
| Edge buffering | Storing readings locally (IndexedDB) during connectivity loss |
| Dead reckoning | Estimating position from a known start, direction/route, and elapsed time |
| Connection gap | Missing telemetry because the network dropped (data still captured locally) |
| Device-off gap | Missing telemetry because the device stopped capturing (no data exists) |
| Haversine | Formula for great-circle distance between two lat/lng points |
| Polling | Client repeatedly requesting the latest data on an interval |
| Wake Lock | Browser API that prevents the screen from sleeping |
| Capacitor | Tool to wrap a web app as an installable native app for background capabilities |

---

*End of document — Version 1.0, 24 Jun 2026.*
