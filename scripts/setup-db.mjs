// Runs db/schema.sql against your Neon database.
// Usage: 1) put DATABASE_URL in .env.local   2) npm run db:setup
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const __dirname = dirname(fileURLToPath(import.meta.url));

// load .env.local if present (dotenv loads .env by default)
try {
  const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env.local, rely on process env */ }

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\n  ✗ DATABASE_URL is not set. Add it to .env.local first.\n');
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');

// strip line comments, then split into individual statements
const statements = schema
  .replace(/--[^\n]*/g, '')
  .split(';')
  .map((s) => s.trim())
  .filter((s) => s.length);

console.log(`\n  Running ${statements.length} statements against Neon...\n`);
for (const stmt of statements) {
  const label = stmt.replace(/\s+/g, ' ').slice(0, 64);
  try {
    await sql.query(stmt);
    console.log('  ✓ ' + label);
  } catch (e) {
    console.error('  ✗ ' + label + '\n    ' + e.message);
    process.exit(1);
  }
}
console.log('\n  ✓ Database ready.\n');
