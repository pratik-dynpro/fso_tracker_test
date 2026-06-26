import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { authorized } from '@/lib/auth';
import { haversineMeters, GAP_SECONDS } from '@/lib/geo';
import type { TrackPoint } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tripId: string | undefined = body?.tripId;
  const points: TrackPoint[] = Array.isArray(body?.points) ? body.points : [];
  if (!tripId || points.length === 0) {
    return NextResponse.json({ error: 'tripId and points[] required' }, { status: 400 });
  }

  const sql = getSql();

  const trips = await sql`
    SELECT status, last_lat, last_lng, last_recorded_at,
           distance_measured_m, distance_estimated_m
    FROM trips WHERE id = ${tripId}`;
  if (!trips.length) {
    return NextResponse.json({ error: 'trip not found' }, { status: 404 });
  }
  const trip = trips[0];
  if (trip.status !== 'active') {
    return NextResponse.json({ error: 'trip not active' }, { status: 409 });
  }

  // process strictly in capture order so the running distance is correct,
  // even when an offline batch arrives out of order
  const sorted = [...points].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  let prevLat: number | null = trip.last_lat != null ? Number(trip.last_lat) : null;
  let prevLng: number | null = trip.last_lng != null ? Number(trip.last_lng) : null;
  let prevTime: number | null = trip.last_recorded_at
    ? new Date(trip.last_recorded_at).getTime()
    : null;
  let measured = Number(trip.distance_measured_m) || 0;
  let estimated = Number(trip.distance_estimated_m) || 0;

  let accepted = 0;
  for (const p of sorted) {
    const lat = Number(p.lat);
    const lng = Number(p.lng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) continue;
    const acc = p.accuracy != null ? Number(p.accuracy) : null;
    const t = new Date(p.recordedAt).getTime();
    const clientPingId: string | null = p.clientPingId ?? null;
    let isGap = false;
    let d = 0;

    if (prevLat != null && prevLng != null && prevTime != null) {
      d = haversineMeters(prevLat, prevLng, lat, lng);
      const dtSec = (t - prevTime) / 1000;
      isGap = dtSec > GAP_SECONDS;
    }

    // Upsert on (trip_id, client_ping_id) so retries are ignored, not duplicated.
    // Rows with NULL client_ping_id always insert (legacy/non-Capacitor clients).
    const inserted = await sql`
      INSERT INTO locations (trip_id, lat, lng, accuracy_m, recorded_at, is_gap, client_ping_id)
      VALUES (${tripId}, ${lat}, ${lng}, ${acc}, ${new Date(t).toISOString()}, ${isGap}, ${clientPingId})
      ON CONFLICT (trip_id, client_ping_id) WHERE client_ping_id IS NOT NULL
        DO NOTHING
      RETURNING id`;

    if (inserted.length === 0) continue;  // duplicate retry — distance unchanged, prev unchanged

    if (isGap) estimated += d;
    else       measured += d;

    prevLat = lat;
    prevLng = lng;
    prevTime = t;
    accepted++;
  }

  await sql`
    UPDATE trips SET
      last_lat = ${prevLat}, last_lng = ${prevLng},
      last_recorded_at = ${prevTime != null ? new Date(prevTime).toISOString() : null},
      distance_measured_m = ${measured},
      distance_estimated_m = ${estimated},
      updated_at = now()
    WHERE id = ${tripId}`;

  return NextResponse.json({
    ok: true,
    accepted,
    distanceMeasuredM: measured,
    distanceEstimatedM: estimated,
    distanceTotalM: measured + estimated,
  });
}
