import { NextResponse } from 'next/server';
import { getSql } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Diagnostic: which DB is this deployment actually using, and how many trips it sees.
 *  (Returns only the host, never the password.) */
export async function GET() {
  const url = process.env.DATABASE_URL || '';
  const host = url.match(/@([^/?]+)/)?.[1] || 'NOT SET';
  let trips = -1;
  let activeTrips = -1;
  try {
    const sql = getSql();
    const a = await sql`SELECT count(*)::int AS n FROM trips`;
    const b = await sql`SELECT count(*)::int AS n FROM trips WHERE status = 'active'`;
    trips = a[0].n;
    activeTrips = b[0].n;
  } catch (e: any) {
    return NextResponse.json({ dbHost: host, error: e.message }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json(
    { dbHost: host, trips, activeTrips },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
