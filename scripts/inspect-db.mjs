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
const sbAnon = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data: users, error: uErr } = await sbAdmin.auth.admin.listUsers();
  console.log('Auth users count:', users?.users?.length, 'error:', uErr);
  if (users?.users) {
    console.log('Users:', users.users.map(u => ({ id: u.id, email: u.email })));
  }

  const { data: profiles, error: pErr } = await sbAdmin.from('profiles').select('*');
  console.log('Profiles:', profiles, 'error:', pErr);

  const { data: subs, error: sErr } = await sbAdmin.from('subscriptions').select('*');
  console.log('Subscriptions:', subs, 'error:', sErr);

  const { data: compMods, error: cmErr } = await sbAdmin.from('company_modules').select('*');
  console.log('Company modules:', compMods, 'error:', cmErr);

  // Test anon insert into hotel_rooms:
  const testRoom = {
    company_id: '11111111-1111-4111-8111-111111111111',
    room_number: 'TEST-' + Date.now(),
    category: 'Standard',
    capacity: 2,
    price_per_night: 50000,
    currency: 'XOF',
    status: 'available',
  };
  const { data: anonData, error: anonErr } = await sbAnon.from('hotel_rooms').insert(testRoom).select().single();
  console.log('Anon insert test into hotel_rooms:', { data: anonData, error: anonErr?.message });
}

run();
