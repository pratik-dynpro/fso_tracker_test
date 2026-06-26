'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type * as LType from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './trip.css';

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
  const mapRef = useRef<LType.Map | null>(null);

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
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      const el = document.getElementById('trip-map');
      if (!el) return;
      const map = L.map(el);
      mapRef.current = map;
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);

      const all: [number, number][] = [];

      // build measured + estimated segments
      const measured: [number, number][] = [];
      const estSegs: [number, number][][] = [];
      let prev: [number, number] | null = null;
      for (const pt of data.points) {
        const ll: [number, number] = [pt.lat, pt.lng];
        all.push(ll);
        if (pt.isGap && prev) estSegs.push([prev, ll]);
        else measured.push(ll);
        prev = ll;
      }
      if (measured.length) L.polyline(measured, { color: '#1f8f55', weight: 4 }).addTo(map);
      if (estSegs.length) L.polyline(estSegs, { color: '#e2640f', weight: 4, dashArray: '4 8' }).addTo(map);

      // start + end markers
      if (data.points.length) {
        const s = data.points[0];
        L.circleMarker([s.lat, s.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#2b6cb0', fillOpacity: 1 })
          .addTo(map)
          .bindTooltip('Start', { permanent: true, direction: 'left', className: 'veh-label start' });
        const e = data.points[data.points.length - 1];
        L.circleMarker([e.lat, e.lng], { radius: 6, color: '#fff', weight: 2, fillColor: '#1b1f27', fillOpacity: 1 })
          .addTo(map)
          .bindTooltip('End', { permanent: true, direction: 'right', className: 'veh-label end' });
      }

      // destination
      if (data.trip.destination) {
        const d = data.trip.destination;
        all.push([d.lat, d.lng]);
        L.circleMarker([d.lat, d.lng], { radius: 7, color: '#fff', weight: 3, fillColor: '#e2640f', fillOpacity: 1 })
          .addTo(map)
          .bindTooltip('Job', { permanent: true, direction: 'right', className: 'veh-label job' });
      }

      if (all.length === 1) map.setView(all[0], 15);
      else if (all.length > 1) map.fitBounds(L.latLngBounds(all).pad(0.3));
      else map.setView([22.5937, 78.9629], 5);
      setTimeout(() => map.invalidateSize(), 200);
    })();
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
