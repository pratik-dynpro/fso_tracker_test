import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { metersToMiles } from '@/lib/geo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

/** Recent trips (active + ended) so the dispatcher can review and clean up history. */
export async function GET() {
  const sql = getSql();
  const rows = await sql`
    SELECT t.id, t.job_ref, t.status, t.started_at, t.ended_at,
           t.dest_address, t.distance_measured_m, t.distance_estimated_m,
           d.name AS driver_name
    FROM trips t
    JOIN drivers d ON d.id = t.driver_id
    ORDER BY t.started_at DESC
    LIMIT 100`;

  return NextResponse.json(
    rows.map((t) => {
      const measured = Number(t.distance_measured_m) || 0;
      const estimated = Number(t.distance_estimated_m) || 0;
      return {
        tripId: t.id as string,
        driverName: t.driver_name as string,
        jobRef: (t.job_ref as string) ?? null,
        destAddress: (t.dest_address as string) ?? null,
        status: t.status as string,
        startedAt: t.started_at as string,
        endedAt: (t.ended_at as string) ?? null,
        distanceTotalMi: Number(metersToMiles(measured + estimated).toFixed(2)),
      };
    }),
    { headers: { 'Cache-Control': 'no-store, max-age=0' } }
  );
}
