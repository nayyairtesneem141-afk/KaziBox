import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const env = fs.readFileSync('platform/.env.local', 'utf8');
const envVars = Object.fromEntries(
  env.split('\n')
    .filter(l => l.includes('='))
    .map(l => {
      const [k, ...v] = l.split('=');
      return [k.trim(), v.join('=').trim().replace(/^["']|["']$/g, '')];
    })
);

const sbAdmin = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Check if we can query functions from information_schema
  const { data: routines, error } = await sbAdmin
    .from('information_schema.routines')
    .select('routine_name')
    .eq('routine_schema', 'public');
  console.log('Routines query:', { routines, error: error?.message });

  // Test Supabase SQL endpoint with service key
  const sqlRes = await fetch(`${envVars.NEXT_PUBLIC_SUPABASE_URL}/pg`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: envVars.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${envVars.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ query: 'SELECT 1;' }),
  });
  console.log('/pg status:', sqlRes.status);

  // Test management / v1 / sql endpoint
  const sqlRes2 = await fetch(`${envVars.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: envVars.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${envVars.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ sql: 'SELECT 1;' }),
  });
  console.log('rpc exec_sql status:', sqlRes2.status);
}

run();
