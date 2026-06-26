import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { authorized } from '@/lib/auth';
import { adminAuthorized } from '@/lib/admin';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // a trip can be ended by the technician (ingest secret) or by a dispatcher (admin password)
  if (!authorized(req) && !adminAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const tripId: string | undefined = body?.tripId;
  if (!tripId) {
    return NextResponse.json({ error: 'tripId required' }, { status: 400 });
  }

  const sql = getSql();
  const rows = await sql`
    UPDATE trips
    SET status = 'ended', ended_at = now(), updated_at = now()
    WHERE id = ${tripId} AND status = 'active'
    RETURNING distance_measured_m, distance_estimated_m`;

  if (!rows.length) {
    return NextResponse.json({ error: 'trip not found or already ended' }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    distanceMeasuredM: Number(rows[0].distance_measured_m),
    distanceEstimatedM: Number(rows[0].distance_estimated_m),
  });
}
