import fs from 'fs';
import path from 'path';

// read .env.local
const envPath = path.resolve('platform/.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value.trim();
  }
});

const url = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

const { createClient } = await import('./node_modules/@supabase/supabase-js/dist/index.mjs');

const adminClient = createClient(url, serviceKey);

async function run() {
  const { data: companies } = await adminClient.from('companies').select('*');
  console.log('Companies:', companies?.map(c => ({ id: c.id, name: c.name })));

  const { data: subs } = await adminClient.from('subscriptions').select('*');
  console.log('Subscriptions:', JSON.stringify(subs?.map(s => ({ id: s.id, company_id: s.company_id, status: s.status, modules: s.included_module_ids })), null, 2));

  const { data: compMods } = await adminClient.from('company_modules').select('*');
  console.log('Company Modules:', JSON.stringify(compMods, null, 2));

  // Check garage tables
  const { data: gCust, error: gCustErr } = await adminClient.from('garage_customers').select('*');
  console.log('Garage customers count:', gCust?.length, 'Error:', gCustErr);

  const { data: gVeh, error: gVehErr } = await adminClient.from('garage_vehicles').select('*');
  console.log('Garage vehicles count:', gVeh?.length, 'Error:', gVehErr);

  // Check salon tables
  const { data: sCust, error: sCustErr } = await adminClient.from('salon_customers').select('*');
  console.log('Salon customers count:', sCust?.length, 'Error:', sCustErr);
}

run();
