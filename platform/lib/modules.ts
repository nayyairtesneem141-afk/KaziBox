import { ModuleManifest } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getSubscription } from './billing';
import { notifyModuleActivated, notifyModuleDeactivated } from './notifications';

/**
 * Fetch all registered modules
 * In Supabase: const { data } = await supabase.from('modules').select('*').order('name');
 */
export async function getModules(): Promise<ModuleManifest[]> {
  const store = getStore();
  return store.modules;
}

/**
 * Fetch single module by slug or id
 * In Supabase: const { data } = await supabase.from('modules').select('*').or(`id.eq.${slugOrId},slug.eq.${slugOrId}`).single();
 */
export async function getModule(slugOrId: string): Promise<ModuleManifest | null> {
  const store = getStore();
  const found = store.modules.find((m) => m.id === slugOrId || m.slug === slugOrId);
  return found || null;
}

/**
 * Check if the workspace has active subscription access to a given module
 * In Supabase: RPC check or subscription joined query
 */
export async function hasModuleAccess(companyId: string, moduleId: string): Promise<boolean> {
  const sub = await getSubscription(companyId);
  if (!sub) return false;
  if (sub.status !== 'active' && sub.status !== 'expiring_soon') return false;

  // All Access plan grants access to all published modules
  if (sub.planId === 'all_access') return true;

  return sub.includedModuleIds.includes(moduleId);
}

/**
 * Activate a module for the given workspace
 * In Supabase: update subscription or module_activations junction table
 */
export async function activateModule(
  companyId: string,
  moduleId: string
): Promise<{ success: boolean; message?: string }> {
  await new Promise((r) => setTimeout(r, 300));
  const store = getStore();
  const subIdx = store.subscriptions.findIndex(
    (s) => s.companyId === companyId && (s.status === 'active' || s.status === 'expiring_soon')
  );

  if (subIdx === -1) {
    return {
      success: false,
      message: 'Aucun abonnement actif couvrant ce module. Redirection vers la facturation...',
    };
  }

  const sub = store.subscriptions[subIdx];
  if (!sub.includedModuleIds.includes(moduleId)) {
    sub.includedModuleIds.push(moduleId);
    store.subscriptions[subIdx] = { ...sub };
    setStoreItem('SUBSCRIPTIONS', store.subscriptions);
  }

  const mod = await getModule(moduleId);
  const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
  await notifyModuleActivated(companyId, modName);

  return { success: true };
}

/**
 * Deactivate a module for the given workspace
 * Confirms deactivation and keeps data for 30 days
 */
export async function deactivateModule(
  companyId: string,
  moduleId: string
): Promise<{ success: boolean; message?: string }> {
  await new Promise((r) => setTimeout(r, 300));
  const store = getStore();
  const subIdx = store.subscriptions.findIndex((s) => s.companyId === companyId);

  if (subIdx !== -1) {
    const sub = store.subscriptions[subIdx];
    sub.includedModuleIds = sub.includedModuleIds.filter((id) => id !== moduleId);
    store.subscriptions[subIdx] = { ...sub };
    setStoreItem('SUBSCRIPTIONS', store.subscriptions);
  }

  const mod = await getModule(moduleId);
  const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
  await notifyModuleDeactivated(companyId, modName);

  return {
    success: true,
    message: 'Vos données sont conservées pendant 30 jours.',
  };
}
