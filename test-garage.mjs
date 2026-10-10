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
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const { createClient } = await import('./node_modules/@supabase/supabase-js/dist/index.mjs');
const adminClient = createClient(url, serviceKey);
const anonClient = createClient(url, anonKey);

async function testGarage() {
  console.log('--- Testing Garage Customer with Admin Client ---');
  const company1 = '11111111-1111-4111-8111-111111111111';
  const company2 = '22222222-2222-4222-8222-222222222222';

  // Test inserting garage_customer
  const res1 = await adminClient.from('garage_customers').insert({
    company_id: company2,
    name: 'Test Client Garage',
    phone: '+221 77 000 00 00',
  }).select().single();
  console.log('Admin insert customer company2:', res1.data?.id, 'Error:', res1.error);

  const res1b = await adminClient.from('garage_customers').insert({
    company_id: company1,
    name: 'Test Client Garage Co1',
    phone: '+221 77 111 11 11',
  }).select().single();
  console.log('Admin insert customer company1:', res1b.data?.id, 'Error:', res1b.error);

  // Test inserting garage_vehicle
  if (res1.data) {
    const res2 = await adminClient.from('garage_vehicles').insert({
      company_id: company2,
      customer_id: res1.data.id,
      registration_number: 'TEST-123',
      make: 'Toyota',
      model: 'Corolla',
    }).select('*, customer:garage_customers(*)').single();
    console.log('Admin insert vehicle company2:', res2.data?.id, 'Error:', res2.error);
  }

  // Now test with Anon Client (browser client without session)
  console.log('\n--- Testing with Anon Client (like browser) ---');
  const anonCust = await anonClient.from('garage_customers').insert({
    company_id: company2,
    name: 'Anon Client Garage',
    phone: '+221 77 222 22 22',
  }).select().single();
  console.log('Anon insert customer:', anonCust.data?.id, 'Error:', anonCust.error);

  const anonGet = await anonClient.from('garage_customers').select('*').eq('company_id', company2);
  console.log('Anon select customers count:', anonGet.data?.length, 'Error:', anonGet.error);

  // Check RLS policies on garage_customers and garage_vehicles
  console.log('\n--- Checking RLS policies ---');
  const { data: policies, error: polErr } = await adminClient.rpc('get_policies_for_table', { table_name: 'garage_customers' });
  if (polErr) {
    console.log('RPC not available, querying pg_policies');
    // Let's inspect via raw query if possible or check migration files
  }
}

testGarage();
