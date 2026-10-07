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
  const { data: modules } = await sbAdmin.from('modules').select('id, slug, name, pricing');
  console.log('Modules in Supabase:', modules);
}

run();
