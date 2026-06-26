'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type * as LType from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { PositionDTO, TripSummary } from '@/lib/types';
import './dispatch.css';

const POLL_MS = 4000;
const DEFAULT_CENTER: [number, number] = [22.5937, 78.9629]; // India, until a technician loads
const DISPATCH_PASSWORD = process.env.NEXT_PUBLIC_DISPATCH_PASSWORD || 'Dynpro@1996';

export default function DispatchPage() {
  const [positions, setPositions] = useState<PositionDTO[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  // ---- password gate ----
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const adminPw = useRef('');

  useEffect(() => {
    const saved = sessionStorage.getItem('mc_dispatch_pw');
    if (saved && saved === DISPATCH_PASSWORD) {
      adminPw.current = saved;
      setAuthed(true);
    }
  }, []);

  function submitPw(e: React.FormEvent) {
    e.preventDefault();
    if (pw === DISPATCH_PASSWORD) {
      sessionStorage.setItem('mc_dispatch_pw', pw);
      adminPw.current = pw;
      setPwErr('');
      setAuthed(true);
    } else {
      setPwErr('Incorrect password.');
    }
  }

  // ---- trip history ----
  const [history, setHistory] = useState<TripSummary[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/trips/list', { cache: 'no-store' });
      const data: TripSummary[] = await res.json();
      setHistory(data.filter((t) => !deletedIds.current.has(t.tripId)));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (authed) loadHistory();
  }, [authed, loadHistory]);

  // ---- admin actions ----
  async function endTrip(tripId: string) {
    if (!confirm('End this trip now? The technician will stop being tracked.')) return;
    try {
      const res = await fetch('/api/trips/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-admin-password': adminPw.current },
        body: JSON.stringify({ tripId }),
      });
      if (!res.ok && res.status !== 404) {
        const e = await res.json().catch(() => ({}));
        alert(`Could not end trip: ${e.error || res.status}`);
        return;
      }
    } catch {
      alert('Could not end trip: network error.');
      return;
    }
    setPositions((ps) => ps.filter((p) => p.tripId !== tripId));
    loadHistory();
  }

  async function deleteTrip(tripId: string) {
    if (!confirm('Delete this trip and ALL its records permanently? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/trips/${tripId}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': adminPw.current },
      });
      if (!res.ok && res.status !== 404) {
        const e = await res.json().catch(() => ({}));
        alert(`Could not delete trip: ${e.error || res.status}`);
        return;
      }
    } catch {
      alert('Could not delete trip: network error.');
      return;
    }
    deletedIds.current.add(tripId);
    setPositions((ps) => ps.filter((p) => p.tripId !== tripId));
    setHistory((hs) => hs.filter((t) => t.tripId !== tripId));
    loadHistory();
  }

  // ---- map refs ----
  const deletedIds = useRef<Set<string>>(new Set());
  const LRef = useRef<typeof import('leaflet') | null>(null);
  const mapRef = useRef<LType.Map | null>(null);
  const markers = useRef<Map<string, LType.CircleMarker>>(new Map());
  const startMarkers = useRef<Map<string, LType.CircleMarker>>(new Map());
  const destMarkers = useRef<Map<string, LType.CircleMarker>>(new Map());
  const measuredLines = useRef<Map<string, LType.Polyline>>(new Map());
  const estLines = useRef<Map<string, LType.Polyline>>(new Map());
  const didFit = useRef(false);

  // ---- create the OpenStreetMap (Leaflet) ----
  useEffect(() => {
    if (!authed) return;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled) return;
      const el = document.getElementById('map');
      if (!el || mapRef.current) return;
      const map = L.map(el).setView(DEFAULT_CENTER, 5);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      LRef.current = L;
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 200);
      setMapReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [authed]);

  // ---- poll positions ----
  useEffect(() => {
    if (!authed) return;
    let alive = true;
    async function tick() {
      try {
        const res = await fetch('/api/positions', { cache: 'no-store' });
        const data: PositionDTO[] = await res.json();
        if (!alive) return;
        const filtered = data.filter((p) => !deletedIds.current.has(p.tripId));
        setPositions(filtered);
        setConnected(true);
        if (!selected && filtered.length) setSelected(filtered[0].tripId);
      } catch {
        if (alive) setConnected(false);
      }
    }
    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, authed]);

  // ---- draw on map ----
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    if (!L || !map || !mapReady) return;

    const seen = new Set<string>();
    const allPts: [number, number][] = [];

    for (const p of positions) {
      seen.add(p.tripId);
      const color = p.stale ? '#e2640f' : '#1f8f55';

      // technician marker (only if it has a position)
      if (p.last) {
        const ll: [number, number] = [p.last.lat, p.last.lng];
        allPts.push(ll);
        let m = markers.current.get(p.tripId);
        if (!m) {
          m = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 3, fillColor: color, fillOpacity: 1 });
          m.addTo(map);
          m.on('click', () => setSelected(p.tripId));
          m.bindTooltip('', { permanent: true, direction: 'right', offset: [8, 0], className: 'veh-label' });
          markers.current.set(p.tripId, m);
        } else {
          m.setLatLng(ll);
          m.setStyle({ fillColor: color });
        }
        m.setTooltipContent(`${p.driverName}${p.stale ? ' (lost)' : ''}`);
      }

      // split track into measured vs estimated
      const measured: [number, number][] = [];
      const estSegs: [number, number][][] = [];
      let prev: [number, number] | null = null;
      for (const pt of p.track) {
        const ll: [number, number] = [pt.lat, pt.lng];
        if (pt.isGap && prev) estSegs.push([prev, ll]);
        else measured.push(ll);
        prev = ll;
      }

      let ml = measuredLines.current.get(p.tripId);
      if (!ml) {
        ml = L.polyline(measured, { color: '#1f8f55', weight: 4, opacity: 0.95 }).addTo(map);
        measuredLines.current.set(p.tripId, ml);
      } else {
        ml.setLatLngs(measured);
      }

      let el = estLines.current.get(p.tripId);
      if (!el) {
        el = L.polyline(estSegs, { color: '#e2640f', weight: 4, dashArray: '4 8' }).addTo(map);
        estLines.current.set(p.tripId, el);
      } else {
        el.setLatLngs(estSegs);
      }

      // start marker (blue dot)
      if (p.start) {
        const ll: [number, number] = [p.start.lat, p.start.lng];
        allPts.push(ll);
        let sm = startMarkers.current.get(p.tripId);
        if (!sm) {
          sm = L.circleMarker(ll, { radius: 5, color: '#fff', weight: 2, fillColor: '#2b6cb0', fillOpacity: 1 });
          sm.addTo(map);
          sm.bindTooltip('Start', { permanent: true, direction: 'left', className: 'veh-label start' });
          startMarkers.current.set(p.tripId, sm);
        } else {
          sm.setLatLng(ll);
        }
      }

      // destination marker (orange)
      if (p.destination) {
        const ll: [number, number] = [p.destination.lat, p.destination.lng];
        allPts.push(ll);
        let dm = destMarkers.current.get(p.tripId);
        if (!dm) {
          dm = L.circleMarker(ll, { radius: 7, color: '#fff', weight: 3, fillColor: '#e2640f', fillOpacity: 1 });
          dm.addTo(map);
          dm.bindTooltip('Job', { permanent: true, direction: 'right', className: 'veh-label job' });
          destMarkers.current.set(p.tripId, dm);
        } else {
          dm.setLatLng(ll);
        }
      }
    }

    // remove layers for trips no longer present
    const drop = (mapRefObj: Map<string, LType.Layer>) => {
      for (const [id, layer] of mapRefObj) if (!seen.has(id)) { map.removeLayer(layer); mapRefObj.delete(id); }
    };
    drop(markers.current as unknown as Map<string, LType.Layer>);
    drop(startMarkers.current as unknown as Map<string, LType.Layer>);
    drop(destMarkers.current as unknown as Map<string, LType.Layer>);
    drop(measuredLines.current as unknown as Map<string, LType.Layer>);
    drop(estLines.current as unknown as Map<string, LType.Layer>);

    if (allPts.length && !didFit.current) {
      if (allPts.length === 1) map.setView(allPts[0], 15);
      else map.fitBounds(L.latLngBounds(allPts).pad(0.3));
      didFit.current = true;
    }
  }, [positions, mapReady]);

  // pan to selected
  useEffect(() => {
    const map = mapRef.current;
    const p = positions.find((x) => x.tripId === selected);
    if (map && p?.last) map.panTo([p.last.lat, p.last.lng]);
  }, [selected, positions]);

  // ---- password gate ----
  if (!authed) {
    return (
      <>
        <header className="topbar">
          <div className="topbar-inner">
            <Link className="brand" href="/">
              <svg className="pin" viewBox="0 0 24 24" fill="#e2640f" aria-hidden>
                <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
                <circle cx="12" cy="9" r="2.6" fill="#fff" />
              </svg>
              <span><b>McCarthy Tyre</b><small>Dispatch console</small></span>
            </Link>
          </div>
        </header>
        <div className="gate">
          <form className="gate-card" onSubmit={submitPw}>
            <h2>Dispatcher sign-in</h2>
            <p>Enter the dispatcher password to open the live console.</p>
            {pwErr && <div className="gate-err">{pwErr}</div>}
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus />
            <button type="submit">Unlock console</button>
          </form>
        </div>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            <svg className="pin" viewBox="0 0 24 24" fill="#e2640f" aria-hidden>
              <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
              <circle cx="12" cy="9" r="2.6" fill="#fff" />
            </svg>
            <span><b>McCarthy Tyre</b><small>Dispatch console</small></span>
          </Link>
          <div className="toplinks"><Link href="/track">Technician page →</Link></div>
        </div>
      </header>

      <div className="dsp-wrap">
        <div className="console">
          <div className="console-head">
            <div className="console-title">
              Dispatch — Live View
              <span className={`live ${connected ? '' : 'off'}`}>
                <span className="dot" />
                {connected ? `Live · every ${POLL_MS / 1000}s` : 'Connecting…'}
              </span>
            </div>
            <div className="note">{positions.length} active</div>
          </div>

          <div id="map" />

          <div className="roster">
            <div className="roster-head"><span>Technicians ({positions.length})</span><span>Distance · ETA</span></div>
            {positions.length === 0 && <div className="empty">No active trips. Start one on the technician page.</div>}
            {positions.map((p) => (
              <div key={p.tripId} className={`tech ${selected === p.tripId ? 'sel' : ''}`} onClick={() => setSelected(p.tripId)}>
                <div className="tech-top">
                  <span className="tech-name">{p.driverName}</span>
                  <span className={`st ${p.stale ? 'st-off' : 'st-en'}`}>{p.stale ? 'Signal lost' : 'En route'}</span>
                </div>
                <div className="tech-meta">
                  <div>Distance<b>{p.distanceTotalMi.toFixed(1)} mi</b></div>
                  <div>To go<b>{p.distanceToGoMi != null ? p.distanceToGoMi.toFixed(1) + ' mi' : '—'}</b></div>
                  <div>ETA<b>{p.etaMin != null ? p.etaMin + ' min' : '—'}</b></div>
                </div>
                <div className="tech-meta">
                  <div className="est">Estimated<b>{p.distanceEstimatedMi.toFixed(1)} mi</b></div>
                  <div>Last fix<b>{p.last ? new Date(p.last.recordedAt).toLocaleTimeString() : '—'}</b></div>
                </div>
                <div className="job-ref">
                  {p.jobRef ? `Job #${p.jobRef}` : 'No job ref'}
                  {p.destination?.address ? ` · → ${p.destination.address}` : ''}
                  {p.stale ? ' · estimating position…' : ''}
                </div>
                <div className="tech-actions">
                  <button className="act end" onClick={(e) => { e.stopPropagation(); endTrip(p.tripId); }}>■ End trip</button>
                  <button className="act del" onClick={(e) => { e.stopPropagation(); deleteTrip(p.tripId); }}>🗑 Delete</button>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="note" style={{ marginTop: 12 }}>
          Map by OpenStreetMap (free). Green = measured GPS track · dashed orange = estimated across a signal gap.
          Estimated miles are counted separately so they can be excluded from billing.
        </p>

        <div className="history">
          <button
            className="hist-toggle"
            onClick={() => { setShowHistory((s) => !s); loadHistory(); }}
          >
            {showHistory ? '▾' : '▸'} Trip history &amp; cleanup ({history.length})
          </button>
          {showHistory && (
            <div className="hist-list">
              {history.length === 0 && <div className="empty">No trips recorded yet.</div>}
              {history.map((t) => (
                <div key={t.tripId} className="hist-row">
                  <Link className="hist-main" href={`/trip/${t.tripId}`}>
                    <div className="hist-top">
                      <b>{t.driverName}</b>
                      <span className={`st ${t.status === 'active' ? 'st-en' : 'st-ended'}`}>{t.status}</span>
                      <span className="hist-view">view →</span>
                    </div>
                    <div className="hist-meta">
                      {t.jobRef ? `Job #${t.jobRef} · ` : ''}
                      {t.distanceTotalMi.toFixed(1)} mi · {new Date(t.startedAt).toLocaleString()}
                      {t.destAddress ? ` · → ${t.destAddress}` : ''}
                    </div>
                  </Link>
                  <button className="act del" onClick={() => deleteTrip(t.tripId)}>🗑 Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
