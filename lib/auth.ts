import type { NextRequest } from 'next/server';

/** Write endpoints are guarded by a shared secret. If INGEST_SECRET is unset
 *  (e.g. while testing), the check is disabled and all writes are allowed. */
export function authorized(req: NextRequest): boolean {
  const required = process.env.INGEST_SECRET;
  if (!required) return true;
  return req.headers.get('x-ingest-secret') === required;
}
