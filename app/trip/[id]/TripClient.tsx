'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Loader } from '@googlemaps/js-api-loader';
import './trip.css';

const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
const DASHED_SYMBOL: google.maps.Symbol = {
  path: 'M 0,-1 0,1',
  strokeOpacity: 1,
  scale: 3,
};

interface TripPoint { lat: number; lng: number; accuracy: number | null; recordedAt: string; isGap: boolean; }
interface TripDetail {
  trip: {
    id: string; driverName: string; jobRef: string | null; status: string;
    startedAt: string; endedAt: string | null;
    destination: { lat: number; lng: number } | null;
    distanceMeasuredMi: number; distanceEstimatedMi: number; distanceTotalMi: number;
  };
  points: TripPoint[];
}

function fmtDuration(start: string, end: string | null): string {
  if (!end) return '—';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  const h = Math.floor(m / 60);
  const s = Math.floor((ms % 60000) / 1000);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export default function TripClient() {
  const params = useParams();
  const id = String(params.id);
  const [data, setData] = useState<TripDetail | null>(null);
  const [error, setError] = useState('');
  const mapRef = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    fetch(`/api/trips/${id}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Trip not found'))))
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  // render the route once data is loaded
  useEffect(() => {
    if (!data || mapRef.current) return;
    if (data.points.length === 0 && !data.trip.destination) return;
    if (!GMAPS_KEY) {
      console.warn('[trip] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set; map will not load.');
      return;
    }
    let cancelled = false;
    const loader = new Loader({ apiKey: GMAPS_KEY, version: 'weekly' });
    loader.load().then((google) => {
      if (cancelled) return;
      const el = document.getElementById('trip-map');
      if (!el) return;

      const map = new google.maps.Map(el, {
        center: { lat: 22.5937, lng: 78.9629 },
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      mapRef.current = map;

      const circle = (fill: string, scale: number, stroke = '#fff') => ({
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: fill, fillOpacity: 1, strokeColor: stroke, strokeWeight: 2, scale,
      });

      const all: google.maps.LatLngLiteral[] = [];

      // measured + estimated segments
      const measured: google.maps.LatLngLiteral[] = [];
      const estSegs: google.maps.LatLngLiteral[] = [];
      let prev: google.maps.LatLngLiteral | null = null;
      for (const pt of data.points) {
        const ll: google.maps.LatLngLiteral = { lat: pt.lat, lng: pt.lng };
        all.push(ll);
        if (pt.isGap && prev) { estSegs.push(prev, ll); }
        else measured.push(ll);
        prev = ll;
      }
      if (measured.length) {
        new google.maps.Polyline({ path: measured, map, strokeColor: '#1f8f55', strokeWeight: 4 });
      }
      if (estSegs.length) {
        new google.maps.Polyline({
          path: estSegs, map, strokeColor: '#e2640f', strokeOpacity: 0,
          icons: [{ icon: { ...DASHED_SYMBOL, strokeColor: '#e2640f' }, offset: '0', repeat: '12px' }],
        });
      }

      // start + end markers
      if (data.points.length) {
        const s = data.points[0];
        new google.maps.Marker({ position: { lat: s.lat, lng: s.lng }, map, icon: circle('#2b6cb0', 6), title: 'Start' });
        const e = data.points[data.points.length - 1];
        new google.maps.Marker({ position: { lat: e.lat, lng: e.lng }, map, icon: circle('#1b1f27', 6), title: 'End' });
      }

      // destination
      if (data.trip.destination) {
        const d = data.trip.destination;
        const pos = { lat: d.lat, lng: d.lng };
        all.push(pos);
        const m = new google.maps.Marker({ position: pos, map, icon: circle('#e2640f', 7), title: 'Job destination — click for directions' });
        m.addListener('click', () => {
          const url = `https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lng}&travelmode=driving`;
          window.open(url, '_blank');
        });
      }

      if (all.length === 1) {
        map.setCenter(all[0]);
        map.setZoom(15);
      } else if (all.length > 1) {
        const bounds = new google.maps.LatLngBounds();
        all.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 50);
      }
    }).catch((e) => console.error('[trip] Google Maps failed to load', e));
    return () => { cancelled = true; };
  }, [data]);

  const Header = (
    <header className="topbar">
      <div className="topbar-inner">
        <Link className="brand" href="/">
          <svg className="pin" viewBox="0 0 24 24" fill="#e2640f" aria-hidden>
            <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
            <circle cx="12" cy="9" r="2.6" fill="#fff" />
          </svg>
          <span><b>McCarthy Tyre</b><small>Trip review</small></span>
        </Link>
        <div className="toplinks"><Link href="/dispatch">← Dispatch</Link></div>
      </div>
    </header>
  );

  if (error) {
    return (<>{Header}<div className="trip-wrap"><p className="loading">{error}. <Link href="/dispatch">Back to dispatch</Link></p></div></>);
  }
  if (!data) {
    return (<>{Header}<div className="trip-wrap"><p className="loading">Loading trip…</p></div></>);
  }

  const t = data.trip;
  const hasTrack = data.points.length > 0;

  return (
    <>
      {Header}
      <div className="trip-wrap">
        <Link className="trip-back" href="/dispatch">← Back to dispatch</Link>
        <div className="trip-grid">
          <div className="trip-head">
            <h2>{t.driverName} {t.jobRef ? `· Job #${t.jobRef}` : ''}</h2>
            <span className={`st ${t.status === 'active' ? 'st-en' : 'st-ended'}`}>{t.status}</span>
          </div>

          {hasTrack || t.destination ? <div id="trip-map" /> : (
            <div className="no-track">No GPS was recorded for this trip (the device never sent a location).</div>
          )}

          <div className="trip-side">
            <div className="kv">
              <div className="k">Total distance</div>
              <div className="v big">{t.distanceTotalMi.toFixed(2)} <small>mi</small></div>
              <div className="dist-split">
                <div><div className="sub">Measured</div><b>{t.distanceMeasuredMi.toFixed(2)} mi</b></div>
                <div className="est"><div className="sub">Estimated</div><b>{t.distanceEstimatedMi.toFixed(2)} mi</b></div>
              </div>
            </div>
            <div className="kv"><div className="k">Started</div><div className="v">{new Date(t.startedAt).toLocaleString()}</div></div>
            <div className="kv"><div className="k">Ended</div><div className="v">{t.endedAt ? new Date(t.endedAt).toLocaleString() : 'In progress'}</div></div>
            <div className="kv"><div className="k">Duration</div><div className="v">{fmtDuration(t.startedAt, t.endedAt)}</div></div>
            <div className="kv"><div className="k">GPS points recorded</div><div className="v">{data.points.length}</div></div>
            <div className="kv"><div className="k">Destination</div><div className="v" style={{ fontSize: '.92rem', fontWeight: 400 }}>{t.destination ? `${t.destination.lat.toFixed(5)}, ${t.destination.lng.toFixed(5)}` : 'Not set'}</div></div>
          </div>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          🔵 Start · ⚫ End · 🟠 Job destination · green line = measured GPS · dashed orange = estimated across a gap.
        </p>
      </div>
    </>
  );
}
