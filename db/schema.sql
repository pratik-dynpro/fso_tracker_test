-- McCarthy Tyre Services — Technician GPS Tracking
-- Schema for Neon Postgres (no PostGIS required; distance is computed in code via haversine)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- for gen_random_uuid()

-- ---------- drivers (the tracked technicians / cab drivers) ----------
CREATE TABLE IF NOT EXISTS drivers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- trips (one tracking session / job) ----------
CREATE TABLE IF NOT EXISTS trips (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id            uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  job_ref              text,
  dest_lat             double precision,         -- known destination (for gap estimation / ETA)
  dest_lng             double precision,
  dest_address         text,                     -- human-readable destination, if entered
  status               text NOT NULL DEFAULT 'active',   -- 'active' | 'ended'
  started_at           timestamptz NOT NULL DEFAULT now(),
  ended_at             timestamptz,
  -- running totals, kept up to date on each ingest for O(1) reads
  distance_measured_m  double precision NOT NULL DEFAULT 0,
  distance_estimated_m double precision NOT NULL DEFAULT 0,
  -- last known point (so we can compute incremental distance without re-scanning)
  last_lat             double precision,
  last_lng             double precision,
  last_recorded_at     timestamptz,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_driver ON trips(driver_id);

-- ---------- locations (every GPS reading) ----------
CREATE TABLE IF NOT EXISTS locations (
  id           bigserial PRIMARY KEY,
  trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  accuracy_m   double precision,
  recorded_at  timestamptz NOT NULL,            -- time captured on the phone (preserved for offline points)
  received_at  timestamptz NOT NULL DEFAULT now(), -- time the server got it
  is_gap       boolean NOT NULL DEFAULT false    -- true if this point closes a signal/device gap
);

CREATE INDEX IF NOT EXISTS idx_locations_trip_time ON locations(trip_id, recorded_at);

-- ---------- safe migrations for existing databases ----------
ALTER TABLE trips ADD COLUMN IF NOT EXISTS dest_address text;

-- Idempotency: each point carries a client-generated UUID. Retries must be
-- ignored, not duplicated. Partial index so existing rows with NULL pass.
ALTER TABLE locations ADD COLUMN IF NOT EXISTS client_ping_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS uq_locations_trip_clientping
  ON locations (trip_id, client_ping_id)
  WHERE client_ping_id IS NOT NULL;
