import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { metersToMiles } from '@/lib/geo';
import { adminAuthorized } from '@/lib/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/** Admin-only: permanently delete a trip and all its location records. */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  if (!adminAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sql = getSql();
  const rows = await sql`DELETE FROM trips WHERE id = ${params.id} RETURNING id`;
  if (!rows.length) {
    return NextResponse.json({ error: 'trip not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const sql = getSql();
  const id = params.id;

  const trips = await sql`
    SELECT t.*, d.name AS driver_name
    FROM trips t JOIN drivers d ON d.id = t.driver_id
    WHERE t.id = ${id}`;
  if (!trips.length) {
    return NextResponse.json({ error: 'trip not found' }, { status: 404 });
  }
  const t = trips[0];

  const points = await sql`
    SELECT lat, lng, accuracy_m, recorded_at, is_gap
    FROM locations WHERE trip_id = ${id}
    ORDER BY recorded_at ASC`;

  const measured = Number(t.distance_measured_m) || 0;
  const estimated = Number(t.distance_estimated_m) || 0;

  return NextResponse.json({
    trip: {
      id: t.id,
      driverName: t.driver_name,
      jobRef: t.job_ref,
      status: t.status,
      startedAt: t.started_at,
      endedAt: t.ended_at,
      destination: t.dest_lat != null ? { lat: Number(t.dest_lat), lng: Number(t.dest_lng) } : null,
      distanceMeasuredMi: Number(metersToMiles(measured).toFixed(2)),
      distanceEstimatedMi: Number(metersToMiles(estimated).toFixed(2)),
      distanceTotalMi: Number(metersToMiles(measured + estimated).toFixed(2)),
    },
    points: points.map((p) => ({
      lat: Number(p.lat),
      lng: Number(p.lng),
      accuracy: p.accuracy_m != null ? Number(p.accuracy_m) : null,
      recordedAt: p.recorded_at,
      isGap: Boolean(p.is_gap),
    })),
  });
}
