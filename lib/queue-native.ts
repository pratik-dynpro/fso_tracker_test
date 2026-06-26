'use client';
import { Preferences } from '@capacitor/preferences';
import type { TrackPoint } from './types';

const KEY = 'mc_ping_queue_v1';

interface Entry { key: string; point: TrackPoint }

async function load(): Promise<Entry[]> {
  const { value } = await Preferences.get({ key: KEY });
  if (!value) return [];
  try { return JSON.parse(value) as Entry[]; }
  catch { return []; }
}

async function save(entries: Entry[]): Promise<void> {
  await Preferences.set({ key: KEY, value: JSON.stringify(entries) });
}

export async function enqueue(point: TrackPoint): Promise<void> {
  const entries = await load();
  entries.push({ key: point.clientPingId, point });
  await save(entries);
}

export async function peekBatch(
  limit = 200
): Promise<{ key: string; point: TrackPoint }[]> {
  const entries = await load();
  return entries.slice(0, limit);
}

export async function removeKeys(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const set = new Set(keys);
  const entries = await load();
  const filtered = entries.filter(e => !set.has(e.key));
  await save(filtered);
}

export async function queueCount(): Promise<number> {
  const entries = await load();
  return entries.length;
}
