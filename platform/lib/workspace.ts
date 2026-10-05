import { Workspace } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getSession } from './auth';

/**
 * Fetch all workspaces for the account or tenant
 * In Supabase: const { data } = await supabase.from('companies').select('*');
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  const store = getStore();
  return store.workspaces;
}

/**
 * Fetch workspace by company_id
 * In Supabase: const { data } = await supabase.from('companies').select('*').eq('id', companyId).single();
 */
export async function getWorkspace(companyId: string): Promise<Workspace | null> {
  const store = getStore();
  const ws = store.workspaces.find((w) => w.company_id === companyId || w.id === companyId);
  return ws || null;
}

/**
 * Create new workspace / company
 * In Supabase: const { data } = await supabase.from('companies').insert({...}).select().single();
 */
export async function createWorkspace(params: {
  name: string;
  country: string;
  currency: string;
  language?: string;
  logo_url?: string;
}): Promise<{ data: Workspace | null; error: Error | null }> {
  await new Promise((resolve) => setTimeout(resolve, 350));
  const store = getStore();

  const newId = `ws-${Date.now()}`;
  const newWorkspace: Workspace = {
    id: newId,
    company_id: newId,
    name: params.name.trim(),
    country: params.country,
    currency: params.currency,
    language: params.language || 'fr',
    logo_url: params.logo_url || '',
    created_at: new Date().toISOString(),
    plan: 'starter',
    status: 'active',
  };

  store.workspaces.push(newWorkspace);
  setStoreItem('WORKSPACES', store.workspaces);

  // Switch session to newly created workspace
  const session = await getSession();
  if (session && typeof window !== 'undefined') {
    session.workspace = newWorkspace;
    session.user.company_id = newId;
    localStorage.setItem('kazibox_current_session', JSON.stringify(session));
    document.cookie = `kazibox_session=${encodeURIComponent(
      JSON.stringify({ userId: session.user.id, companyId: newWorkspace.company_id })
    )}; path=/; max-age=604800; SameSite=Lax`;
  }

  return { data: newWorkspace, error: null };
}

/**
 * Update workspace / company details
 * In Supabase: const { data } = await supabase.from('companies').update(updates).eq('id', companyId).select().single();
 */
export async function updateWorkspace(
  companyId: string,
  updates: Partial<Workspace>
): Promise<{ data: Workspace | null; error: Error | null }> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  const store = getStore();
  const idx = store.workspaces.findIndex((w) => w.company_id === companyId || w.id === companyId);

  if (idx === -1) {
    return { data: null, error: new Error('Espace de travail introuvable') };
  }

  const updated: Workspace = {
    ...store.workspaces[idx],
    ...updates,
  };

  store.workspaces[idx] = updated;
  setStoreItem('WORKSPACES', store.workspaces);

  // Refresh current session if editing active workspace
  const session = await getSession();
  if (session && session.workspace.company_id === companyId && typeof window !== 'undefined') {
    session.workspace = updated;
    localStorage.setItem('kazibox_current_session', JSON.stringify(session));
  }

  return { data: updated, error: null };
}

/**
 * Switch active workspace
 */
export async function switchWorkspace(companyId: string): Promise<boolean> {
  const target = await getWorkspace(companyId);
  if (!target) return false;

  const session = await getSession();
  if (!session || typeof window === 'undefined') return false;

  session.workspace = target;
  session.user.company_id = target.company_id;
  localStorage.setItem('kazibox_current_session', JSON.stringify(session));
  document.cookie = `kazibox_session=${encodeURIComponent(
    JSON.stringify({ userId: session.user.id, companyId: target.company_id })
  )}; path=/; max-age=604800; SameSite=Lax`;

  return true;
}
