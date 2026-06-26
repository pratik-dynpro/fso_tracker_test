import { NextRequest, NextResponse } from 'next/server';
import { getSql } from '@/lib/db';
import { authorized } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const driverName = body?.driverName?.toString().trim();
  if (!driverName) {
    return NextResponse.json({ error: 'driverName required' }, { status: 400 });
  }
  const jobRef = body?.jobRef ? String(body.jobRef) : null;
  const destLat = body?.destLat != null ? Number(body.destLat) : null;
  const destLng = body?.destLng != null ? Number(body.destLng) : null;
  const destAddress = body?.destAddress ? String(body.destAddress) : null;

  const sql = getSql();

  // find or create the driver by name
  const existing = await sql`SELECT id FROM drivers WHERE name = ${driverName}`;
  let driverId: string;
  if (existing.length) {
    driverId = existing[0].id as string;
  } else {
    const created = await sql`INSERT INTO drivers (name) VALUES (${driverName}) RETURNING id`;
    driverId = created[0].id as string;
  }

  const trip = await sql`
    INSERT INTO trips (driver_id, job_ref, dest_lat, dest_lng, dest_address, status, started_at)
    VALUES (${driverId}, ${jobRef}, ${destLat}, ${destLng}, ${destAddress}, 'active', now())
    RETURNING id`;

  return NextResponse.json({ tripId: trip[0].id, driverId });
}
