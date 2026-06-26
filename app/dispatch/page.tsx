'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader } from '@googlemaps/js-api-loader';
import type { PositionDTO, TripSummary } from '@/lib/types';
import './dispatch.css';

const POLL_MS = 4000;
const DEFAULT_CENTER: google.maps.LatLngLiteral = { lat: 22.5937, lng: 78.9629 }; // India, until a technician loads
const DISPATCH_PASSWORD = process.env.NEXT_PUBLIC_DISPATCH_PASSWORD || 'Dynpro@1996';
const GMAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Dashed-line symbol for "estimated" segments — Google Maps fakes dashes by
// repeating a single line glyph along an otherwise-invisible polyline.
const DASHED_SYMBOL: google.maps.Symbol = {
  path: 'M 0,-1 0,1',
  strokeOpacity: 1,
  scale: 3,
};

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
  const mapRef = useRef<google.maps.Map | null>(null);
  const markers = useRef<Map<string, google.maps.Marker>>(new Map());
  const startMarkers = useRef<Map<string, google.maps.Marker>>(new Map());
  const destMarkers = useRef<Map<string, google.maps.Marker>>(new Map());
  const measuredLines = useRef<Map<string, google.maps.Polyline>>(new Map());
  const estLines = useRef<Map<string, google.maps.Polyline>>(new Map());
  const didFit = useRef(false);

  // ---- create the Google Map ----
  useEffect(() => {
    if (!authed) return;
    if (!GMAPS_KEY) {
      console.warn('[dispatch] NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set; map will not load.');
      return;
    }
    let cancelled = false;
    const loader = new Loader({ apiKey: GMAPS_KEY, version: 'weekly' });
    loader.load().then((google) => {
      if (cancelled) return;
      const el = document.getElementById('map');
      if (!el || mapRef.current) return;
      const map = new google.maps.Map(el, {
        center: DEFAULT_CENTER,
        zoom: 5,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
      });
      mapRef.current = map;
      setMapReady(true);
    }).catch((e) => console.error('[dispatch] Google Maps failed to load', e));
    return () => { cancelled = true; };
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
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const seen = new Set<string>();
    const allPts: google.maps.LatLngLiteral[] = [];

    const circle = (fillColor: string, scale: number) => ({
      path: google.maps.SymbolPath.CIRCLE,
      fillColor,
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      scale,
    });

    for (const p of positions) {
      seen.add(p.tripId);
      const color = p.stale ? '#e2640f' : '#1f8f55';

      // technician marker
      if (p.last) {
        const pos: google.maps.LatLngLiteral = { lat: p.last.lat, lng: p.last.lng };
        allPts.push(pos);
        let m = markers.current.get(p.tripId);
        if (!m) {
          m = new google.maps.Marker({
            position: pos,
            map,
            icon: circle(color, 8),
            label: { text: `${p.driverName}${p.stale ? ' (lost)' : ''}`, color: '#0f141c', fontWeight: '600', fontSize: '12px', className: 'veh-label-html' },
            title: p.driverName,
            zIndex: 1000,
          });
          m.addListener('click', () => setSelected(p.tripId));
          markers.current.set(p.tripId, m);
        } else {
          m.setPosition(pos);
          m.setIcon(circle(color, 8));
          m.setLabel({ text: `${p.driverName}${p.stale ? ' (lost)' : ''}`, color: '#0f141c', fontWeight: '600', fontSize: '12px', className: 'veh-label-html' });
        }
      }

      // split track into measured + estimated segments
      const measured: google.maps.LatLngLiteral[] = [];
      const estSegs: google.maps.LatLngLiteral[] = [];
      let prev: google.maps.LatLngLiteral | null = null;
      for (const pt of p.track) {
        const ll: google.maps.LatLngLiteral = { lat: pt.lat, lng: pt.lng };
        if (pt.isGap && prev) { estSegs.push(prev, ll); }
        else { measured.push(ll); }
        prev = ll;
      }

      let ml = measuredLines.current.get(p.tripId);
      if (!ml) {
        ml = new google.maps.Polyline({
          path: measured, map,
          strokeColor: '#1f8f55', strokeWeight: 4, strokeOpacity: 0.95,
        });
        measuredLines.current.set(p.tripId, ml);
      } else {
        ml.setPath(measured);
      }

      let el = estLines.current.get(p.tripId);
      if (!el) {
        el = new google.maps.Polyline({
          path: estSegs, map,
          strokeColor: '#e2640f', strokeOpacity: 0,
          icons: [{ icon: { ...DASHED_SYMBOL, strokeColor: '#e2640f' }, offset: '0', repeat: '12px' }],
        });
        estLines.current.set(p.tripId, el);
      } else {
        el.setPath(estSegs);
      }

      // start marker (blue)
      if (p.start) {
        const pos: google.maps.LatLngLiteral = { lat: p.start.lat, lng: p.start.lng };
        allPts.push(pos);
        let sm = startMarkers.current.get(p.tripId);
        if (!sm) {
          sm = new google.maps.Marker({ position: pos, map, icon: circle('#2b6cb0', 5), title: 'Start' });
          startMarkers.current.set(p.tripId, sm);
        } else {
          sm.setPosition(pos);
        }
      }

      // destination marker (orange) — clicking it opens Google Maps directions
      if (p.destination) {
        const pos: google.maps.LatLngLiteral = { lat: p.destination.lat, lng: p.destination.lng };
        allPts.push(pos);
        let dm = destMarkers.current.get(p.tripId);
        if (!dm) {
          dm = new google.maps.Marker({ position: pos, map, icon: circle('#e2640f', 7), title: 'Job destination — click for directions' });
          dm.addListener('click', () => {
            const url = `https://www.google.com/maps/dir/?api=1&destination=${pos.lat},${pos.lng}&travelmode=driving`;
            window.open(url, '_blank');
          });
          destMarkers.current.set(p.tripId, dm);
        } else {
          dm.setPosition(pos);
        }
      }
    }

    // remove overlays for trips no longer present
    const dropMarkers = (m: Map<string, google.maps.Marker>) => {
      for (const [id, mk] of m) if (!seen.has(id)) { mk.setMap(null); m.delete(id); }
    };
    const dropLines = (m: Map<string, google.maps.Polyline>) => {
      for (const [id, ln] of m) if (!seen.has(id)) { ln.setMap(null); m.delete(id); }
    };
    dropMarkers(markers.current);
    dropMarkers(startMarkers.current);
    dropMarkers(destMarkers.current);
    dropLines(measuredLines.current);
    dropLines(estLines.current);

    if (allPts.length && !didFit.current) {
      if (allPts.length === 1) {
        map.setCenter(allPts[0]);
        map.setZoom(15);
      } else {
        const bounds = new google.maps.LatLngBounds();
        allPts.forEach((p) => bounds.extend(p));
        map.fitBounds(bounds, 50);
      }
      didFit.current = true;
    }
  }, [positions, mapReady]);

  // pan to selected
  useEffect(() => {
    const map = mapRef.current;
    const p = positions.find((x) => x.tripId === selected);
    if (map && p?.last) map.panTo({ lat: p.last.lat, lng: p.last.lng });
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
