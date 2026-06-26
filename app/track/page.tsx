'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { startTracking, stopTracking, type TrackerUpdate } from '@/lib/tracker';
import { apiUrl } from '@/lib/api';
import './track.css';

type GeocodeResult =
  | { ok: true; lat: number; lng: number; formatted: string }
  | { ok: false; status: string };

/** Convert a typed address into coordinates using the free OpenStreetMap
 *  (Nominatim) geocoder — no API key, no billing required. */
async function geocode(address: string): Promise<GeocodeResult> {
  try {
    const url =
      'https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' +
      encodeURIComponent(address);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, status: 'HTTP_' + res.status };
    const data = await res.json();
    if (Array.isArray(data) && data.length) {
      return {
        ok: true,
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        formatted: data[0].display_name,
      };
    }
    return { ok: false, status: 'ZERO_RESULTS' };
  } catch {
    return { ok: false, status: 'NETWORK' };
  }
}

type Phase = 'idle' | 'tracking' | 'lost' | 'ended';

export default function TrackPage() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [driverName, setDriverName] = useState('');
  const [jobRef, setJobRef] = useState('');
  const [destInput, setDestInput] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [distanceMi, setDistanceMi] = useState(0);
  const [queued, setQueued] = useState(0);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [speedMph, setSpeedMph] = useState(0);
  const [lastSent, setLastSent] = useState<string>('—');

  const tripIdRef = useRef<string | null>(null);
  const wakeLockRef = useRef<any>(null);
  const lastFixAt = useRef<number>(0);

  // restore persisted identity
  useEffect(() => {
    setDriverName(localStorage.getItem('mc_driver') || '');
    setJobRef(localStorage.getItem('mc_job') || '');
    setDestInput(localStorage.getItem('mc_dest') || '');
    setSecret(localStorage.getItem('mc_secret') || '');
  }, []);

  const headers = useCallback((): HeadersInit => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (secret) h['x-ingest-secret'] = secret;
    return h;
  }, [secret]);

  async function requestWakeLock() {
    try {
      const wl = (navigator as any).wakeLock;
      if (wl) wakeLockRef.current = await wl.request('screen');
    } catch {
      /* not supported — fine */
    }
  }

  async function start() {
    setError('');
    if (!driverName.trim()) {
      setError('Enter the technician / driver name first.');
      return;
    }
    if (!('geolocation' in navigator)) {
      setError('This device/browser does not support geolocation.');
      return;
    }
    localStorage.setItem('mc_driver', driverName);
    localStorage.setItem('mc_job', jobRef);
    localStorage.setItem('mc_dest', destInput);
    localStorage.setItem('mc_secret', secret);

    setBusy(true);
    // resolve the destination address (if any) to coordinates
    let dest: { lat: number; lng: number; formatted: string } | null = null;
    if (destInput.trim()) {
      const g = await geocode(destInput.trim());
      if (!g.ok) {
        setBusy(false);
        if (g.status === 'ZERO_RESULTS') {
          setError(`Couldn't find "${destInput.trim()}". Try a fuller address (e.g. "Baner, Pune"), or leave it blank.`);
        } else {
          setError(`Destination lookup failed (${g.status}). Try again in a moment, or leave it blank.`);
        }
        return;
      }
      dest = { lat: g.lat, lng: g.lng, formatted: g.formatted };
    }

    let tripId: string;
    try {
      const res = await fetch(apiUrl('/api/trips/start'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          driverName: driverName.trim(),
          jobRef: jobRef.trim() || null,
          destLat: dest?.lat ?? null,
          destLng: dest?.lng ?? null,
          destAddress: dest?.formatted ?? null,
        }),
      });
      if (!res.ok) throw new Error('Could not start trip (' + res.status + ')');
      const data = await res.json();
      tripIdRef.current = data.tripId;
      tripId = data.tripId;
    } catch (e: any) {
      setBusy(false);
      setError(e.message || 'Could not start trip.');
      return;
    }
    setBusy(false);

    setPhase('tracking');
    setDistanceMi(0);
    lastFixAt.current = Date.now();
    await requestWakeLock();

    await startTracking({
      tripId,
      ingestSecret: secret,
      onUpdate: (u: TrackerUpdate) => {
        setQueued(u.queued);
        if (u.lastSent) setLastSent(u.lastSent);
        if (u.accuracy != null) setAccuracy(u.accuracy);
        setSpeedMph(u.speedMph);
        lastFixAt.current = Date.now();
        setPhase((p) => (p === 'lost' ? 'tracking' : p));
      },
    });

    // Open Google Maps directions to the destination in a new tab / native
    // Maps app. The tracking page stays mounted so GPS keeps recording.
    if (dest) {
      const url = `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}&travelmode=driving`;
      window.open(url, '_blank');
    }
  }

  async function stop() {
    await stopTracking();
    const tripId = tripIdRef.current;
    if (tripId) {
      await fetch(apiUrl('/api/trips/end'), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ tripId }),
      }).catch(() => {});
    }
    try {
      await wakeLockRef.current?.release?.();
    } catch {}
    wakeLockRef.current = null;
    tripIdRef.current = null;
    setPhase('ended');
  }

  // detect "signal lost": no fix for >30s while tracking
  useEffect(() => {
    if (phase !== 'tracking' && phase !== 'lost') return;
    const t = setInterval(() => {
      if (Date.now() - lastFixAt.current > 30000) setPhase('lost');
    }, 5000);
    return () => clearInterval(t);
  }, [phase]);

  // re-acquire wake lock when tab returns to foreground; the tracker owns its
  // own flush loop now, so we just bump the wake lock here.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && (phase === 'tracking' || phase === 'lost')) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [phase]);

  const lost = phase === 'lost';

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href="/">
            <svg className="pin" viewBox="0 0 24 24" fill="#e2640f" aria-hidden>
              <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
              <circle cx="12" cy="9" r="2.6" fill="#fff" />
            </svg>
            <span>
              <b>McCarthy Tyre</b>
              <small>Technician tracker</small>
            </span>
          </Link>
        </div>
      </header>

      <div className="tk-wrap">
        {error && <div className="err">{error}</div>}

        {phase === 'idle' || phase === 'ended' ? (
          <div className="tk-setup">
            <h2>{phase === 'ended' ? 'Trip ended' : 'Start a trip'}</h2>
            <p>
              {phase === 'ended'
                ? `Recorded ${distanceMi.toFixed(1)} mi. Start another trip when you head out again.`
                : 'Enter your details, then start when you leave for the job.'}
            </p>
            <div className="field">
              <label>Technician / driver name</label>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="e.g. Maya Rodriguez" />
            </div>
            <div className="field">
              <label>Destination address (the job location)</label>
              <input value={destInput} onChange={(e) => setDestInput(e.target.value)} placeholder="e.g. MG Road, Bengaluru — or leave blank" />
            </div>
            <div className="row2">
              <div className="field">
                <label>Job reference (optional)</label>
                <input value={jobRef} onChange={(e) => setJobRef(e.target.value)} placeholder="e.g. 07885993" />
              </div>
              <div className="field">
                <label>Device passcode</label>
                <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="if set by admin" />
              </div>
            </div>
            <button className="pbtn start" onClick={start} disabled={busy}>
              {busy ? 'Starting…' : '▶ Start trip'}
            </button>
            <p className="tinynote">
              Your start point is captured automatically. {destInput.trim() ? 'Destination will show on the map.' : 'You can add a destination to see ETA.'}
            </p>
          </div>
        ) : (
          <>
            <div className="statusbig">
              <div className={`ring2 spin ${lost ? 'lost' : ''}`}>
                <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7z" />
                  <circle cx="12" cy="9" r="2.6" />
                </svg>
              </div>
              <h3>{lost ? 'Offline — still recording' : 'Tracking active'}</h3>
              <p>{jobRef ? `Job #${jobRef}` : 'No job ref'}</p>
            </div>

            <div className="stat-grid">
              <div className="stat-card"><div className="k">Distance</div><div className="v">{distanceMi.toFixed(1)} <small>mi</small></div></div>
              <div className="stat-card"><div className="k">Last sent</div><div className="v" style={{ fontSize: '1rem' }}>{lastSent}</div></div>
              <div className="stat-card"><div className="k">Accuracy</div><div className="v">{accuracy ?? '—'} <small>m</small></div></div>
              <div className="stat-card"><div className="k">Speed</div><div className="v">{speedMph} <small>mph</small></div></div>
            </div>

            {queued > 0 && (
              <div className="queue">
                <span className="qdot" /> {queued} reading{queued > 1 ? 's' : ''} queued — will send on reconnect
              </div>
            )}

            <button className="pbtn stop" onClick={stop}>■ End trip</button>
            <p className="tinynote">Keep this screen on · location shared while on shift</p>
          </>
        )}
      </div>
    </>
  );
}
