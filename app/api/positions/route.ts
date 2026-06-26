import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { metersToMiles, haversineMeters } from '@/lib/geo';
import type { PositionDTO } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const STALE_MS = 30_000; // no reading for 30s => likely signal lost
const ASSUMED_SPEED_KMH = 40; // for a rough straight-line ETA

export async function GET() {
  const sql = getSql();

  const trips = await sql`
    SELECT t.id, t.job_ref, t.status, t.last_lat, t.last_lng, t.last_recorded_at,
           t.distance_measured_m, t.distance_estimated_m,
           t.dest_lat, t.dest_lng, t.dest_address, d.name AS driver_name
    FROM trips t
    JOIN drivers d ON d.id = t.driver_id
    WHERE t.status = 'active'
    ORDER BY t.started_at DESC`;

  const now = Date.now();
  const result: PositionDTO[] = [];

  for (const t of trips) {
    const track = await sql`
      SELECT lat, lng, is_gap, recorded_at
      FROM locations WHERE trip_id = ${t.id}
      ORDER BY recorded_at ASC
      LIMIT 1000`;

    const lastTime = t.last_recorded_at ? new Date(t.last_recorded_at).getTime() : 0;
    const measured = Number(t.distance_measured_m) || 0;
    const estimated = Number(t.distance_estimated_m) || 0;

    const destination =
      t.dest_lat != null
        ? { lat: Number(t.dest_lat), lng: Number(t.dest_lng), address: (t.dest_address as string) ?? null }
        : null;
    const start = track.length ? { lat: Number(track[0].lat), lng: Number(track[0].lng) } : null;

    let distanceToGoMi: number | null = null;
    let etaMin: number | null = null;
    if (destination && t.last_lat != null) {
      const m = haversineMeters(Number(t.last_lat), Number(t.last_lng), destination.lat, destination.lng);
      distanceToGoMi = Number(metersToMiles(m).toFixed(2));
      etaMin = Math.max(0, Math.round((m / 1000 / ASSUMED_SPEED_KMH) * 60));
    }

    result.push({
      tripId: t.id as string,
      driverName: t.driver_name as string,
      jobRef: (t.job_ref as string) ?? null,
      status: t.status as string,
      last:
        t.last_lat != null
          ? {
              lat: Number(t.last_lat),
              lng: Number(t.last_lng),
              recordedAt: t.last_recorded_at as string,
            }
          : null,
      stale: lastTime ? now - lastTime > STALE_MS : false,
      distanceMeasuredMi: Number(metersToMiles(measured).toFixed(2)),
      distanceEstimatedMi: Number(metersToMiles(estimated).toFixed(2)),
      distanceTotalMi: Number(metersToMiles(measured + estimated).toFixed(2)),
      start,
      destination,
      distanceToGoMi,
      etaMin,
      track: track.map((p) => ({
        lat: Number(p.lat),
        lng: Number(p.lng),
        isGap: Boolean(p.is_gap),
        recordedAt: p.recorded_at as string,
      })),
    });
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
}
