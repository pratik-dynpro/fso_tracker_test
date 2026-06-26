#!/usr/bin/env node
// Build the Capacitor static export.
//
// The technician shell only needs `/track` (and the root landing). Next.js'
// `output: 'export'` refuses to build when `app/api/*` route handlers exist or
// when a dynamic segment (`app/trip/[id]`) has no static params. Both pieces
// continue to live on Vercel; we stash them aside for the duration of the
// Capacitor build, then restore on exit so the Vercel build path is untouched.

import { spawnSync } from 'node:child_process';
import { renameSync, existsSync } from 'node:fs';
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

stash();

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'build'],
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
    env: { ...process.env, BUILD_TARGET: 'capacitor' },
  }
);

restore();
process.exit(result.status ?? 1);
