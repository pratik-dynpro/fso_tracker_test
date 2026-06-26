'use client';
import { v4 as uuidv4 } from 'uuid';
import { Network } from '@capacitor/network';
import { registerPlugin } from '@capacitor/core';
import { isNative } from './runtime';
import { apiUrl } from './api';
import type { TrackPoint } from './types';

import * as webQueue from './queue';
import * as nativeQueue from './queue-native';

type AnyKey = string | IDBValidKey;
interface QueueLike {
  enqueue(p: TrackPoint): Promise<void>;
  peekBatch(limit?: number): Promise<{ key: AnyKey; point: TrackPoint }[]>;
  removeKeys(keys: AnyKey[]): Promise<void>;
  queueCount(): Promise<number>;
}

const queue: QueueLike = (isNative() ? nativeQueue : webQueue) as unknown as QueueLike;

export interface TrackerUpdate {
  queued: number;
  lastSent: string | null;
  accuracy: number | null;
  speedMph: number;
}

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  bearing: number | null;
  time: number;
}
interface BgWatcherOptions {
  backgroundTitle?: string;
  backgroundMessage?: string;
  requestPermissions?: boolean;
  stale?: boolean;
  distanceFilter?: number;
}
interface BackgroundGeolocationPlugin {
  addWatcher(
    opts: BgWatcherOptions,
    cb: (loc: BgLocation | null, err?: { code: string; message: string }) => void
  ): Promise<string>;
  removeWatcher(opts: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = isNative()
  ? registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')
  : null;

let tripId: string | null = null;
let ingestSecret = '';
let watcherId: string | null = null;
let webWatchId: number | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let lastSent: string | null = null;
let onUpdate: ((u: TrackerUpdate) => void) | null = null;
let lastAccuracy: number | null = null;
let lastSpeedMph = 0;

async function emit() {
  if (!onUpdate) return;
  onUpdate({
    queued: await queue.queueCount(),
    lastSent,
    accuracy: lastAccuracy,
    speedMph: lastSpeedMph,
  });
}

async function flush() {
  if (flushing || !tripId) return;
  flushing = true;
  try {
    if (isNative()) {
      const status = await Network.getStatus();
      if (!status.connected) return;
    }
    let batch = await queue.peekBatch(200);
    while (batch.length) {
      const points = batch.map(b => b.point);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ingestSecret) headers['x-ingest-secret'] = ingestSecret;
      const res = await fetch(apiUrl('/api/location'), {
        method: 'POST',
        headers,
        body: JSON.stringify({ tripId, points }),
      });
      if (res.status < 200 || res.status >= 300) break;
      await queue.removeKeys(batch.map(b => b.key));
      lastSent = new Date().toLocaleTimeString();
      batch = await queue.peekBatch(200);
    }
  } catch {
    /* offline / error — queue stays intact, retried on next trigger */
  } finally {
    flushing = false;
    await emit();
  }
}

export async function startTracking(opts: {
  tripId: string;
  ingestSecret: string;
  onUpdate: (u: TrackerUpdate) => void;
}): Promise<void> {
  tripId = opts.tripId;
  ingestSecret = opts.ingestSecret;
  onUpdate = opts.onUpdate;
  lastSent = null;

  if (isNative() && BackgroundGeolocation) {
    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: 'Trip active',
        backgroundMessage: 'Sharing your location with dispatch while on a job.',
        requestPermissions: true,
        stale: false,
        distanceFilter: 25,
      },
      async (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED' && BackgroundGeolocation) {
            await BackgroundGeolocation.openSettings();
          }
          return;
        }
        if (!loc) return;
        lastAccuracy = Math.round(loc.accuracy);
        if (loc.speed != null && !Number.isNaN(loc.speed)) {
          lastSpeedMph = Math.max(0, Math.round(loc.speed * 2.23694));
        }
        await queue.enqueue({
          clientPingId: uuidv4(),
          lat: loc.latitude,
          lng: loc.longitude,
          accuracy: loc.accuracy,
          recordedAt: new Date(loc.time).toISOString(),
        });
        await emit();
        flush();
      }
    );
  } else {
    webWatchId = navigator.geolocation.watchPosition(
      async pos => {
        lastAccuracy = Math.round(pos.coords.accuracy);
        if (pos.coords.speed != null && !Number.isNaN(pos.coords.speed)) {
          lastSpeedMph = Math.max(0, Math.round(pos.coords.speed * 2.23694));
        }
        await queue.enqueue({
          clientPingId: uuidv4(),
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          recordedAt: new Date(pos.timestamp).toISOString(),
        });
        await emit();
      },
      () => { /* handled by the page UI */ },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  }

  flushTimer = setInterval(flush, 20000);
  if (isNative()) {
    Network.addListener('networkStatusChange', s => { if (s.connected) flush(); });
  }
  await emit();
}

export async function stopTracking(): Promise<void> {
  if (watcherId && BackgroundGeolocation) {
    await BackgroundGeolocation.removeWatcher({ id: watcherId });
    watcherId = null;
  }
  if (webWatchId != null) {
    navigator.geolocation.clearWatch(webWatchId);
    webWatchId = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  await flush();
  tripId = null;
  onUpdate = null;
}
