/** The dispatcher/admin password. Override via NEXT_PUBLIC_DISPATCH_PASSWORD
 *  (set it in Vercel too); falls back to the agreed default for the test. */
export function adminPassword(): string {
  return process.env.NEXT_PUBLIC_DISPATCH_PASSWORD || 'Dynpro@1996';
}

/** Guards destructive dispatcher actions (force-end, delete). */
export function adminAuthorized(req: Request): boolean {
  return req.headers.get('x-admin-password') === adminPassword();
}
