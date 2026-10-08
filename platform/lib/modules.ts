import { ModuleManifest } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { getSubscription } from './billing';
import { notifyModuleActivated, notifyModuleDeactivated } from './notifications';
import { dispatchWebhookEvent } from './webhooks';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

/**
 * Fetch all registered modules
 */
export async function getModules(): Promise<ModuleManifest[]> {
  const store = getStore();
  const baseModules = store.modules;

  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase.from('modules').select('*');
      if (data && data.length > 0) {
        const dbMap = new Map<string, any>();
        data.forEach((m: any) => {
          dbMap.set(m.id, m);
          if (m.slug) dbMap.set(m.slug, m);
        });

        const merged: ModuleManifest[] = [];
        const processedIds = new Set<string>();

        // 1. Process base modules (merge DB overrides if present)
        for (const baseMod of baseModules) {
          const dbRow = dbMap.get(baseMod.id) || (baseMod.slug ? dbMap.get(baseMod.slug) : null);
          if (dbRow) {
            const rawManifest = (typeof dbRow.manifest === 'object' && dbRow.manifest !== null) ? dbRow.manifest : {};
            merged.push({
              ...baseMod,
              ...rawManifest,
              id: dbRow.id || baseMod.id,
              slug: dbRow.slug || baseMod.slug,
              name: dbRow.name || baseMod.name,
              description: dbRow.description || baseMod.description,
              tagline: dbRow.tagline || baseMod.tagline,
              category: dbRow.category || baseMod.category,
              pricing_type: baseMod.pricing_type || rawManifest.pricing_type || (dbRow.pricing?.type === 'free' ? 'free' : 'paid'),
              keywords: baseMod.keywords || rawManifest.keywords || [],
              status: dbRow.status === 'active' ? 'published' : (dbRow.status || baseMod.status),
            });
          } else {
            merged.push(baseMod);
          }
          processedIds.add(baseMod.id);
        }

        // 2. Add any third-party / external modules registered in Supabase
        data.forEach((m: any) => {
          if (!processedIds.has(m.id)) {
            const rawManifest = (typeof m.manifest === 'object' && m.manifest !== null) ? m.manifest : {};
            merged.push({
              id: m.id,
              slug: m.slug || m.id,
              name: m.name as any,
              description: m.description as any,
              tagline: m.tagline as any,
              category: m.category || rawManifest.category || 'services',
              pricing_type: rawManifest.pricing_type || (m.pricing?.type === 'free' ? 'free' : 'paid'),
              keywords: rawManifest.keywords || [],
              icon: m.icon,
              kind: m.kind as any || 'external',
              status: m.status === 'active' ? 'published' : (m.status as any),
              developer: m.developer || 'Third-Party Developer',
              version: m.version || '1.0.0',
              minPlatformVersion: m.min_platform_version,
              features: m.features as any,
              pricing: m.pricing as any,
              entryUrl: rawManifest.entryUrl || `/modules/${m.slug || m.id}`,
              menuItems: rawManifest.menuItems || [],
              scopes: rawManifest.scopes || [],
              languages: rawManifest.languages || ['fr', 'en'],
              summaryUrl: rawManifest.summaryUrl || '',
              webhookUrl: rawManifest.webhookUrl || '',
              pwa: rawManifest.pwa || {
                scope: `/modules/${m.slug || m.id}`,
                startUrl: `/modules/${m.slug || m.id}`,
                themeColor: '#6D28D9',
                icons: [],
              },
              ...rawManifest,
            } as ModuleManifest);
            processedIds.add(m.id);
          }
        });

        return merged;
      }
    }
  }

  return baseModules;
}

/**
 * Fetch single module by slug or id
 */
export async function getModule(slugOrId: string): Promise<ModuleManifest | null> {
  const store = getStore();
  const baseFound = store.modules.find((m) => m.id === slugOrId || m.slug === slugOrId);

  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('modules')
        .select('*')
        .or(`id.eq.${slugOrId},slug.eq.${slugOrId}`)
        .maybeSingle();

      if (data) {
        const rawManifest = (typeof data.manifest === 'object' && data.manifest !== null) ? data.manifest : {};
        return {
          ...(baseFound || {}),
          ...rawManifest,
          id: data.id,
          slug: data.slug,
          name: data.name as any,
          description: data.description as any,
          tagline: data.tagline as any,
          category: data.category || (baseFound ? baseFound.category : 'services'),
          pricing_type: baseFound?.pricing_type || rawManifest.pricing_type || (data.pricing?.type === 'free' ? 'free' : 'paid'),
          keywords: baseFound?.keywords || rawManifest.keywords || [],
          icon: data.icon || baseFound?.logo,
          kind: data.kind as any,
          status: data.status === 'active' ? 'published' : (data.status as any),
          developer: data.developer,
          version: data.version,
          minPlatformVersion: data.min_platform_version,
          features: data.features as any,
          pricing: data.pricing as any,
        } as ModuleManifest;
      }
    }
  }

  return baseFound || null;
}

/**
 * Check if the workspace has active subscription access to a given module
 */
export async function hasModuleAccess(companyId: string, moduleId: string): Promise<boolean> {
  const mod = await getModule(moduleId);
  // Free tools are accessible to all workspaces without a paid subscription
  if (mod?.pricing_type === 'free') {
    return true;
  }

  // 1. Check if module has been explicitly cancelled or inactivated in company_modules
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined'
      ? createBrowserClient()
      : (createAdminClient() || createServerClient());

    if (supabase) {
      const { data: compMod } = await supabase
        .from('company_modules')
        .select('status')
        .eq('company_id', companyId)
        .or(`module_id.eq.${moduleId},module_id.eq.${mod?.slug || moduleId}`)
        .maybeSingle();

      if (compMod && (compMod.status === 'cancelled' || compMod.status === 'inactive')) {
        return false;
      }
    }
  }

  // 2. Check workspace subscription
  const sub = await getSubscription(companyId);
  if (!sub) return false;
  if (sub.status !== 'active' && sub.status !== 'expiring_soon') return false;

  // Verify that the module is currently included in the active subscription
  const isIncluded = sub.includedModuleIds.includes(moduleId) || 
    (mod?.slug && sub.includedModuleIds.includes(mod.slug)) ||
    (moduleId === 'garage-auto' && sub.includedModuleIds.includes('garage')) ||
    (moduleId === 'garage' && sub.includedModuleIds.includes('garage-auto')) ||
    (moduleId === 'hair-salon' && (sub.includedModuleIds.includes('salon') || sub.includedModuleIds.includes('salon-beauty'))) ||
    (moduleId === 'salon-beauty' && (sub.includedModuleIds.includes('hair-salon') || sub.includedModuleIds.includes('salon'))) ||
    (moduleId === 'salon' && (sub.includedModuleIds.includes('hair-salon') || sub.includedModuleIds.includes('salon-beauty')));

  if (!isIncluded) {
    return false;
  }

  return true;
}

/**
 * Activate a module for the given workspace
 */
export async function activateModule(
  companyId: string,
  moduleId: string
): Promise<{ success: boolean; message?: string }> {
  const mod = await getModule(moduleId);
  const isFree = mod?.pricing_type === 'free';

  // In the browser, invoke the server API route using service role
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/modules/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, moduleId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // Also sync local storage store if present
        const store = getStore();
        const subIdx = store.subscriptions.findIndex((s) => s.companyId === companyId);
        if (subIdx !== -1) {
          const sub = store.subscriptions[subIdx];
          if (!sub.includedModuleIds.includes(moduleId)) {
            sub.includedModuleIds.push(moduleId);
            store.subscriptions[subIdx] = { ...sub };
            setStoreItem('SUBSCRIPTIONS', store.subscriptions);
          }
        }
        return { success: true };
      }
    } catch {
      // Fall through
    }
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      // Upsert into company_modules
      await supabase.from('company_modules').upsert({
        company_id: companyId,
        module_id: moduleId,
        plan_id: isFree ? 'free' : 'starter',
        status: 'active',
      }, { onConflict: 'company_id,module_id' });

      // Update subscription includedModuleIds if subscription exists
      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (subData) {
        const currentList = Array.isArray(subData.included_module_ids) ? (subData.included_module_ids as string[]) : [];
        if (!currentList.includes(moduleId)) {
          currentList.push(moduleId);
          await supabase.from('subscriptions').update({
            included_module_ids: currentList,
          }).eq('id', subData.id);
        }
      }

      const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
      await notifyModuleActivated(companyId, modName);

      await dispatchWebhookEvent('module.activated', {
        workspaceId: companyId,
        moduleId,
        activatedAt: new Date().toISOString(),
      }, moduleId);

      return { success: true };
    }
  }

  await new Promise((r) => setTimeout(r, 200));
  const store = getStore();
  const subIdx = store.subscriptions.findIndex(
    (s) => s.companyId === companyId && (s.status === 'active' || s.status === 'expiring_soon')
  );

  if (isFree) {
    if (subIdx !== -1) {
      const sub = store.subscriptions[subIdx];
      if (!sub.includedModuleIds.includes(moduleId)) {
        sub.includedModuleIds.push(moduleId);
        store.subscriptions[subIdx] = { ...sub };
        setStoreItem('SUBSCRIPTIONS', store.subscriptions);
      }
    }
    const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
    await notifyModuleActivated(companyId, modName);
    return { success: true };
  }

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

  const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
  await notifyModuleActivated(companyId, modName);

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
  // In the browser, invoke the server API route using service role
  if (typeof window !== 'undefined') {
    try {
      const res = await fetch('/api/v1/modules/deactivate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, moduleId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // Also sync local storage store if present
        const store = getStore();
        const subIdx = store.subscriptions.findIndex((s) => s.companyId === companyId);
        const isSalon = ['hair-salon', 'salon', 'salon-beauty'].includes(moduleId);
        const isGarage = ['garage-auto', 'garage'].includes(moduleId);
        const targetIds = isSalon
          ? ['hair-salon', 'salon', 'salon-beauty']
          : isGarage
          ? ['garage-auto', 'garage']
          : [moduleId, moduleId.replace('-auto', '')];

        if (subIdx !== -1) {
          const sub = store.subscriptions[subIdx];
          sub.includedModuleIds = sub.includedModuleIds.filter((id) => !targetIds.includes(id));
          store.subscriptions[subIdx] = { ...sub };
          setStoreItem('SUBSCRIPTIONS', store.subscriptions);
        }
        return {
          success: true,
          message: 'Vos données sont conservées pendant 30 jours.',
        };
      }
    } catch {
      // Fall through
    }
  }

  if (isSupabaseConfigured()) {
    const supabase: any = createAdminClient() || createServerClient();
    if (supabase) {
      const isSalon = ['hair-salon', 'salon', 'salon-beauty'].includes(moduleId);
      const isGarage = ['garage-auto', 'garage'].includes(moduleId);
      const targetIds = isSalon
        ? ['hair-salon', 'salon', 'salon-beauty']
        : isGarage
        ? ['garage-auto', 'garage']
        : [moduleId, moduleId.replace('-auto', '')];

      for (const tId of targetIds) {
        await supabase
          .from('company_modules')
          .update({ status: 'cancelled' })
          .eq('company_id', companyId)
          .eq('module_id', tId);
      }

      const { data: subData } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (subData && subData.length > 0) {
        for (const sub of subData) {
          const currentList = Array.isArray(sub.included_module_ids) ? (sub.included_module_ids as string[]) : [];
          const updatedList = currentList.filter((id) => !targetIds.includes(id));
          await supabase.from('subscriptions').update({
            included_module_ids: updatedList,
          }).eq('id', sub.id);
        }
      }

      const mod = await getModule(moduleId);
      const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
      await notifyModuleDeactivated(companyId, modName);

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
  }

  await new Promise((r) => setTimeout(r, 300));
  const store = getStore();
  const subIdx = store.subscriptions.findIndex((s) => s.companyId === companyId);

  if (subIdx !== -1) {
    const sub = store.subscriptions[subIdx];
    sub.includedModuleIds = sub.includedModuleIds.filter((id) => id !== moduleId && id !== moduleId.replace('-auto', ''));
    store.subscriptions[subIdx] = { ...sub };
    setStoreItem('SUBSCRIPTIONS', store.subscriptions);
  }

  const mod = await getModule(moduleId);
  const modName = typeof mod?.name === 'string' ? mod.name : mod?.name?.fr || moduleId;
  await notifyModuleDeactivated(companyId, modName);

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
    ? allMods.filter((m) => m.status === 'published' || (m.status as string) === 'active').map((m) => m.id)
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
      try {
        const { getHotelSummary } = require('./hotel');
        const htlSummary = await getHotelSummary(companyId);
        rev = htlSummary.revenue;
        exp = htlSummary.expenses;
        activity = htlSummary.activityCount;
        metrics = htlSummary.metrics || [];
      } catch {
        rev = 450000;
        exp = 87000;
        activity = 14;
        metrics = [
          { id: 'm1', moduleId: modId, label: { fr: 'Chambres occupées', en: 'Occupied Rooms' }, value: '8 / 12 (67%)' },
          { id: 'm2', moduleId: modId, label: { fr: 'Arrivées prévues', en: 'Expected Check-ins' }, value: 4 },
        ];
      }
    } else if (modId === 'garage' || modId === 'garage-auto') {
      try {
        const { getGarageModuleSummary, getGarageMetrics } = require('./garage');
        const gSummary = await getGarageModuleSummary(companyId);
        const gMetrics = await getGarageMetrics(companyId);
        rev = gMetrics.revenueThisMonth;
        exp = 0;
        activity = gMetrics.activeJobs;
        metrics = (gSummary.metrics || []).map((m: any, idx: number) => ({
          id: `gm-${idx}`,
          moduleId: modId,
          label: { fr: m.label, en: m.label },
          value: m.value,
        }));
      } catch {
        rev = 280000;
        exp = 65000;
        activity = 8;
        metrics = [
          { id: 'm3', moduleId: modId, label: { fr: "Véhicules à l'atelier", en: 'Vehicles in shop' }, value: 6 },
          { id: 'm4', moduleId: modId, label: { fr: 'Devis en attente', en: 'Pending quotes' }, value: 2 },
        ];
      }
    } else if (modId === 'hair-salon' || modId === 'salon' || modId === 'salon-beauty') {
      try {
        const { getSalonModuleSummary, getSalonMetrics } = require('./salon');
        const sSummary = await getSalonModuleSummary(companyId);
        const sMetrics = await getSalonMetrics(companyId);
        rev = sMetrics.revenueThisMonth;
        exp = 0;
        activity = sMetrics.todayAppointments;
        metrics = (sSummary.metrics || []).map((m: any, idx: number) => ({
          id: m.id || `sal-m-${idx}`,
          moduleId: 'hair-salon',
          label: m.label || { fr: 'Métrique', en: 'Metric' },
          value: m.value,
          currency: m.currency,
        }));
      } catch {
        rev = 240000;
        exp = 0;
        activity = 8;
        metrics = [
          { id: 'm1', moduleId: modId, label: { fr: 'Rendez-vous du jour', en: "Today's Appointments" }, value: 6 },
          { id: 'm2', moduleId: modId, label: { fr: 'Équipe active', en: 'Active Stylists' }, value: 3 },
        ];
      }
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


