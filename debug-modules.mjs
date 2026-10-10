import fs from 'fs';
import path from 'path';

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

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const { createClient } = await import('./node_modules/@supabase/supabase-js/dist/index.mjs');
const adminClient = createClient(url, serviceKey);

async function check() {
  const { data: mods } = await adminClient.from('modules').select('id, slug, name, pricing');
  console.log('Modules in Supabase:', mods);
}
check();
