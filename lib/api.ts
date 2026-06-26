const BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** Build an absolute API URL for native builds, a relative one for the Vercel browser build. */
export function apiUrl(path: string): string {
  if (!path.startsWith('/')) path = '/' + path;
  return BASE + path;
}
