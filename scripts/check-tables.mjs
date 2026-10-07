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
  const tables = ['companies', 'profiles', 'modules', 'subscriptions', 'company_modules', 'hotel_rooms', 'hotel_guests', 'hotel_reservations', 'finance_records', 'garage_customers', 'garage_vehicles', 'garage_jobs', 'garage_job_items', 'garage_payments'];
  for (const t of tables) {
    const { data, error } = await sbAdmin.from(t).select('count').limit(1);
    console.log(`Table ${t}:`, error ? `Error: ${error.message}` : 'EXISTS');
  }
}

run();
