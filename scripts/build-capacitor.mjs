#!/usr/bin/env node
// Build the Capacitor static export.
//
// The technician shell only needs `/track` (and the root landing). Next.js'
// `output: 'export'` refuses to build when `app/api/*` route handlers exist or
// when a dynamic segment (`app/trip/[id]`) has no static params. Both pieces
// continue to live on Vercel; we stash them aside for the duration of the
// Capacitor build, then restore on exit so the Vercel build path is untouched.

import { spawnSync } from 'node:child_process';
import { renameSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const STASHES = [
  { live: 'app/api',      stash: 'app/_api.capacitor-stash' },
  { live: 'app/trip',     stash: 'app/_trip.capacitor-stash' },
  { live: 'app/dispatch', stash: 'app/_dispatch.capacitor-stash' },
];

function stash() {
  for (const { live, stash } of STASHES) {
    const livePath = resolve(root, live);
    const stashPath = resolve(root, stash);
    if (existsSync(livePath) && !existsSync(stashPath)) {
      renameSync(livePath, stashPath);
      console.log(`[build-capacitor] stashed ${live} → ${stash}`);
    }
  }
}

function restore() {
  for (const { live, stash } of STASHES) {
    const livePath = resolve(root, live);
    const stashPath = resolve(root, stash);
    if (existsSync(stashPath)) {
      renameSync(stashPath, livePath);
      console.log(`[build-capacitor] restored ${live}`);
    }
  }
}

process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });
process.on('uncaughtException', err => { restore(); console.error(err); process.exit(1); });

// Next.js does NOT auto-load files named `.env.capacitor`. Read it ourselves
// and merge the vars into the spawn env so the static export sees them
// (NEXT_PUBLIC_API_BASE in particular — without it the APK calls relative URLs
// that resolve to https://localhost/... inside the WebView and silently fail).
const extraEnv = {};
const envFile = resolve(root, '.env.capacitor');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) extraEnv[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  console.log(`[build-capacitor] loaded ${Object.keys(extraEnv).length} vars from .env.capacitor`);
}
if (process.env.NEXT_PUBLIC_API_BASE) {
  extraEnv.NEXT_PUBLIC_API_BASE = process.env.NEXT_PUBLIC_API_BASE;  // env wins over file
}
console.log(`[build-capacitor] NEXT_PUBLIC_API_BASE = ${extraEnv.NEXT_PUBLIC_API_BASE || '(empty — APK will not reach the backend!)'}`);

stash();

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'build'],
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv, BUILD_TARGET: 'capacitor' },
  }
);

restore();
process.exit(result.status ?? 1);
