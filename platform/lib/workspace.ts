import { Workspace } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getSession } from './auth';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { isSupabaseConfigured } from './supabase/config';

/**
 * Fetch all workspaces for the account or tenant
 */
export async function getWorkspaces(): Promise<Workspace[]> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase.from('companies').select('*');
      if (data && data.length > 0) {
        return data.map((c: any) => ({
          id: c.id,
          company_id: c.id,
          name: c.name,
          country: c.country,
          currency: c.currency,
          language: c.language,
          logo_url: c.logo_url || '',
          created_at: c.created_at,
          plan: c.plan as Workspace['plan'],
          status: c.status as Workspace['status'],
        }));
      }
    }
  }

  const store = getStore();
  return store.workspaces;
}

/**
 * Fetch workspace by company_id
 */
export async function getWorkspace(companyId: string): Promise<Workspace | null> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase.from('companies').select('*').eq('id', companyId).maybeSingle();
      if (data) {
        return {
          id: data.id,
          company_id: data.id,
          name: data.name,
          country: data.country,
          currency: data.currency,
          language: data.language,
          logo_url: data.logo_url || '',
          created_at: data.created_at,
          plan: data.plan as Workspace['plan'],
          status: data.status as Workspace['status'],
        };
      }
    }
  }

  const store = getStore();
  const ws = store.workspaces.find((w) => w.company_id === companyId || w.id === companyId);
  return ws || null;
}

/**
 * Create new workspace / company
 */
export async function createWorkspace(params: {
  name: string;
  country: string;
  currency: string;
  language?: string;
  logo_url?: string;
}): Promise<{ data: Workspace | null; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          name: params.name.trim(),
          country: params.country,
          currency: params.currency,
          language: params.language || 'fr',
          logo_url: params.logo_url || null,
          plan: 'starter',
          status: 'active',
        })
        .select()
        .single();

      if (error || !data) {
        return { data: null, error: new Error(error?.message || 'Erreur lors de la création de la société') };
      }

      const newWorkspace: Workspace = {
        id: data.id,
        company_id: data.id,
        name: data.name,
        country: data.country,
        currency: data.currency,
        language: data.language,
        logo_url: data.logo_url || '',
        created_at: data.created_at,
        plan: data.plan as Workspace['plan'],
        status: data.status as Workspace['status'],
      };

      const session = await getSession();
      if (session && typeof window !== 'undefined') {
        session.workspace = newWorkspace;
        session.user.company_id = data.id;
        localStorage.setItem('kazibox_current_session', JSON.stringify(session));
        document.cookie = `kazibox_session=${encodeURIComponent(
          JSON.stringify({ userId: session.user.id, companyId: newWorkspace.company_id })
        )}; path=/; max-age=604800; SameSite=Lax`;
      }

      return { data: newWorkspace, error: null };
    }
  }

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
 */
export async function updateWorkspace(
  companyId: string,
  updates: Partial<Workspace>
): Promise<{ data: Workspace | null; error: Error | null }> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      const { data, error } = await supabase
        .from('companies')
        .update({
          name: updates.name,
          country: updates.country,
          currency: updates.currency,
          language: updates.language,
          logo_url: updates.logo_url,
          plan: updates.plan,
          status: updates.status,
        })
        .eq('id', companyId)
        .select()
        .single();

      if (error || !data) {
        return { data: null, error: new Error(error?.message || 'Erreur lors de la mise à jour') };
      }

      const updated: Workspace = {
        id: data.id,
        company_id: data.id,
        name: data.name,
        country: data.country,
        currency: data.currency,
        language: data.language,
        logo_url: data.logo_url || '',
        created_at: data.created_at,
        plan: data.plan as Workspace['plan'],
        status: data.status as Workspace['status'],
      };

      const session = await getSession();
      if (session && session.workspace.company_id === companyId && typeof window !== 'undefined') {
        session.workspace = updated;
        localStorage.setItem('kazibox_current_session', JSON.stringify(session));
      }

      return { data: updated, error: null };
    }
  }

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

