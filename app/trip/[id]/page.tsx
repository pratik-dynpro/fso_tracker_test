import TripClient from './TripClient';

// The Capacitor build runs with `output: 'export'`, which requires every
// dynamic route to declare its static params. The technician shell never
// visits /trip/[id]; on Vercel this route is rendered on demand via
// Next.js' default dynamicParams=true fallback. Return [] so the export
// emits no pre-rendered instances.
export function generateStaticParams() {
  return [];
}

export default function TripDetailPage() {
  return <TripClient />;
}
