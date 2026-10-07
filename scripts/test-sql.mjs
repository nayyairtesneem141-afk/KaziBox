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
  // Test rpc
  const { data: rpcData, error: rpcErr } = await sbAdmin.rpc('get_auth_user_company_ids');
  console.log('rpc test:', { rpcData, rpcErr });

  // Test if there is any sql endpoint or exec_sql
  const res = await fetch(`${envVars.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc`, {
    headers: {
      apikey: envVars.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${envVars.SUPABASE_SERVICE_ROLE_KEY}`,
    }
  });
  console.log('rest rpc status:', res.status);
}

run();
