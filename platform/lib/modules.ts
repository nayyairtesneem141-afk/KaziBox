import { ModuleManifest } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getSubscription } from './billing';
import { notifyModuleActivated, notifyModuleDeactivated } from './notifications';
import { dispatchWebhookEvent } from './webhooks';

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

  // Dispatch webhook event to module
  await dispatchWebhookEvent('module.activated', {
    workspaceId: companyId,
    moduleId,
    activatedAt: new Date().toISOString(),
  }, moduleId);

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

  // Dispatch webhook event to module
  await dispatchWebhookEvent('module.deactivated', {
    workspaceId: companyId,
    moduleId,
    deactivatedAt: new Date().toISOString(),
    dataRetentionDays: 30,
  }, moduleId);

  return {
    success: true,
    message: 'Vos données sont conservées pendant 30 jours.',
  };
}

/**
 * In KaziBox, the consolidated dashboard reads ONLY from getModuleSummaries
 * (which queries each active module's public summary contract) and from shared finance,
 * never from module internal database tables.
 */
export async function getModuleSummaries(companyId: string): Promise<any[]> {
  const [sub, allMods] = await Promise.all([
    getSubscription(companyId),
    getModules(),
  ]);

  if (!sub || (sub.status !== 'active' && sub.status !== 'expiring_soon')) {
    return [];
  }

  const activeModIds = sub.planId === 'all_access'
    ? allMods.filter((m) => m.status === 'published').map((m) => m.id)
    : sub.includedModuleIds;

  const summaries: any[] = [];

  for (const modId of activeModIds) {
    const mod = allMods.find((m) => m.id === modId);
    if (!mod) continue;

    let rev = 0;
    let exp = 0;
    let activity = 0;
    let metrics: any[] = [];

    if (modId === 'hotel-property') {
      rev = 450000;
      exp = 87000;
      activity = 14;
      metrics = [
        { id: 'm1', moduleId: modId, label: { fr: 'Chambres occupées', en: 'Occupied Rooms' }, value: '8 / 12 (67%)' },
        { id: 'm2', moduleId: modId, label: { fr: 'Arrivées prévues', en: 'Expected Check-ins' }, value: 4 },
      ];
    } else if (modId === 'garage') {
      rev = 280000;
      exp = 65000;
      activity = 8;
      metrics = [
        { id: 'm3', moduleId: modId, label: { fr: "Véhicules à l'atelier", en: 'Vehicles in shop' }, value: 6 },
        { id: 'm4', moduleId: modId, label: { fr: 'Devis en attente', en: 'Pending quotes' }, value: 2 },
      ];
    } else if (modId === 'demo') {
      rev = 25000;
      exp = 7500;
      activity = 2;
      metrics = [
        { id: 'm5', moduleId: modId, label: { fr: 'Appels API Démo', en: 'Demo API Calls' }, value: 2 },
      ];
    }

    summaries.push({
      moduleId: modId,
      companyId,
      revenue: rev,
      expenses: exp,
      activityCount: activity,
      currency: 'XOF',
      lastUpdated: new Date().toISOString(),
      metrics,
    });
  }

  return summaries;
}

