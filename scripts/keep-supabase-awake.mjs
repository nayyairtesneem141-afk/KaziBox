/**
 * KaziBox — Supabase Keep-Alive Utility
 *
 * Prevents Supabase Free Tier projects from automatic pausing due to 7-day inactivity.
 * Sends a lightweight REST query to the project's PostgREST database endpoint.
 *
 * Can be run manually:
 *   node scripts/keep-supabase-awake.mjs
 * Or automated via GitHub Actions / cron / task scheduler.
 */

import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)?$/);
    if (match) {
      let val = match[2] || '';
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[match[1]] = val.trim();
    }
  }
  return env;
}

// 1. Resolve credentials from environment or local env files
const envLocal = {
  ...loadEnvFile(path.resolve('.env.local')),
  ...loadEnvFile(path.resolve('platform/.env.local')),
};

const supabaseUrl = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  envLocal.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).replace(/\/+$/, '');

const apiKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  envLocal.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  envLocal.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!supabaseUrl || !apiKey) {
  console.error('❌ Error: Missing NEXT_PUBLIC_SUPABASE_URL or API key.');
  process.exit(1);
}

async function pingSupabase() {
  const startTime = Date.now();
  const endpoint = `${supabaseUrl}/rest/v1/companies?select=id&limit=1`;

  console.log(`[${new Date().toISOString()}] Pinging Supabase project...`);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });

    const elapsedMs = Date.now() - startTime;

    if (response.ok) {
      console.log(`✅ Success: Supabase project is active (HTTP ${response.status}, ${elapsedMs}ms).`);
      console.log(`Activity registered. 7-day inactivity pause counter has been reset.`);
    } else {
      const errText = await response.text();
      console.warn(`⚠️ Warning: Received HTTP ${response.status} (${elapsedMs}ms): ${errText}`);
    }
  } catch (err) {
    console.error(`❌ Network error while pinging Supabase:`, err.message);
    process.exit(1);
  }
}

pingSupabase();
