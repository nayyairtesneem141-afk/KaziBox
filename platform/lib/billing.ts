import { Plan, Subscription, PaymentHistoryItem } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { notifySubscriptionActivated, notifyPaymentFailed } from './notifications';
import { dispatchWebhookEvent } from './webhooks';
import { createBrowserClient } from './supabase/client';
import { createServerClient } from './supabase/server';
import { createAdminClient } from './supabase/admin';
import { isSupabaseConfigured } from './supabase/config';

export const PLANS: Plan[] = [
  {
    id: 'single',
    name: {
      en: 'Single Module',
      fr: 'Formule Solo',
    },
    description: {
      en: 'Perfect for single-activity businesses focused on one core module',
      fr: 'Idéal pour les entreprises gérant une seule activité métier ciblée',
    },
    monthlyPrice: 15000,
    yearlyPrice: 150000, // 2 months free (~17% discount)
    currency: 'XOF',
    maxModules: 1,
    features: [
      { en: '1 Business Module of choice', fr: '1 Module métier au choix' },
      { en: 'Unlimited team members', fr: 'Collaborateurs illimités' },
      { en: 'PWA mobile & desktop access', fr: 'Accès PWA mobile & ordinateur' },
      { en: 'Standard email support', fr: 'Support standard par email' },
    ],
    badge: {
      en: 'Starter',
      fr: 'Démarrage',
    },
  },
  {
    id: 'bundle',
    name: {
      en: 'Multi-Module Bundle',
      fr: 'Pack Multi-Métiers',
    },
    description: {
      en: 'Combine up to 3 synergistic modules under one single subscription',
      fr: 'Regroupez jusqu’à 3 modules complémentaires sous un abonnement unique',
    },
    monthlyPrice: 35000,
    yearlyPrice: 350000, // Discounted
    currency: 'XOF',
    maxModules: 3,
    isPopular: true,
    features: [
      { en: 'Up to 3 Business Modules included', fr: 'Jusqu’à 3 modules métiers inclus' },
      { en: 'Consolidated cross-activity dashboard', fr: 'Tableau de bord consolidé multi-activités' },
      { en: 'Unlimited staff and multi-role RBAC', fr: 'Équipe illimitée et rôles personnalisés' },
      { en: 'Priority WhatsApp & phone support', fr: 'Support prioritaire WhatsApp & téléphone' },
    ],
    badge: {
      en: 'Most Popular',
      fr: 'Le plus populaire',
    },
  },
  {
    id: 'all_access',
    name: {
      en: 'All Access Unlimited',
      fr: 'Pass Intégral (All Access)',
    },
    description: {
      en: 'Unrestricted access to all current and future published modules',
      fr: 'Accès sans restriction à tous les modules actuels et futurs',
    },
    monthlyPrice: 55000,
    yearlyPrice: 550000,
    currency: 'XOF',
    features: [
      { en: 'All published catalogue modules', fr: 'Tous les modules du catalogue inclus' },
      { en: 'Automatic unlock of future modules', fr: 'Déblocage automatique des nouveautés' },
      { en: 'Consolidated executive reports', fr: 'Rapports consolidés pour direction' },
      { en: 'Dedicated account advisor', fr: 'Conseiller dédié et audit sur mesure' },
    ],
    badge: {
      en: 'Best Value',
      fr: 'Meilleure valeur',
    },
  },
  {
    id: 'custom',
    name: {
      en: 'Build Your Own (A la Carte)',
      fr: 'Sur-Mesure (À la carte)',
    },
    description: {
      en: 'Pick exactly the modules you need and pay a transparent unit rate',
      fr: 'Sélectionnez précisément vos modules avec un tarif unitaire dégressif',
    },
    monthlyPrice: 13000, // Base per module
    yearlyPrice: 130000,
    currency: 'XOF',
    features: [
      { en: 'Custom module selection with live total', fr: 'Sélection libre avec calcul direct du total' },
      { en: 'Single consolidated workspace invoice', fr: 'Une seule facture centralisée pour l’espace' },
      { en: 'Add or remove modules anytime', fr: 'Ajout ou retrait de modules à tout moment' },
      { en: 'Full PWA and multi-device capabilities', fr: 'PWA complète et mode déconnecté' },
    ],
    badge: {
      en: 'Flexible',
      fr: 'Flexibilité totale',
    },
  },
];

/**
 * Fetch all available platform billing plans
 */
export async function getPlans(): Promise<Plan[]> {
  return PLANS;
}

/**
 * Fetch active or latest subscription for current workspace
 */
export async function getSubscription(companyId: string): Promise<Subscription | null> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined'
      ? createBrowserClient()
      : (createAdminClient() || createServerClient());
    if (supabase) {
      const { data } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .maybeSingle();

      if (data) {
        return {
          id: data.id,
          companyId: data.company_id,
          planId: data.plan_id,
          status: data.status as Subscription['status'],
          billingCycle: 'monthly',
          includedModuleIds: Array.isArray(data.included_module_ids) ? (data.included_module_ids as string[]) : [],
          currentPeriodStart: data.current_period_start,
          currentPeriodEnd: data.current_period_end || undefined,
          renewAt: data.current_period_end || undefined,
          autoRenew: !data.cancel_at_period_end,
          amount: 29000,
          currency: 'XOF',
        };
      }
    }
  }

  const store = getStore();
  const sub = store.subscriptions.find((s) => s.companyId === companyId);
  return sub || null;
}

export interface CheckoutParams {
  companyId: string;
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  moduleIds: string[];
  paymentMethod?: 'mobile_money' | 'card';
  country?: 'CD' | 'CM' | 'SN' | 'CI';
  operator?: string;
  phoneNumber?: string;
  cardName?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvc?: string;
  amount: number;
  currency?: string;
  referralCode?: string;
}

/**
 * Initiates checkout session via Moteur centralized payment infrastructure.
 *
 * CRITICAL RULE:
 * Paid access is NEVER granted through a simulated timer.
 * Entitlements are only activated upon authentic, verified payment confirmation.
 */
export async function startCheckout(params: CheckoutParams): Promise<{
  success: boolean;
  status: 'pending' | 'succeeded' | 'failed' | 'expired' | 'refunded' | 'cancelled';
  reference?: string;
  sessionId?: string;
  invoiceId?: string;
  checkoutUrl?: string;
  error?: string;
  message?: string;
}> {
  // If in browser, invoke server checkout route
  if (typeof window !== 'undefined') {
    try {
      const { getSession } = await import('./auth');
      const session = await getSession();
      const token = session?.token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({
          companyId: params.companyId,
          planId: params.planId,
          billingCycle: params.billingCycle,
          moduleIds: params.moduleIds,
          country: params.country || 'CI',
          amount: params.amount,
          currency: params.currency || 'XOF',
          referralCode: params.referralCode,
          customer: {
            phone: params.phoneNumber,
            name: params.cardName,
          },
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const base = data.errorMessage || data.error || data.message || 'Échec de l’initialisation du paiement';
        const displayError = base;

        return {
          success: false,
          status: 'failed',
          error: displayError,
          message: displayError,
        };
      }

      return {
        success: true,
        status: data.status || 'pending',
        reference: data.reference,
        sessionId: data.sessionId,
        invoiceId: `INV-${data.reference || Date.now()}`,
        checkoutUrl: data.checkoutUrl,
      };
    } catch (err: any) {
      return {
        success: false,
        status: 'failed',
        error: err.message || 'Erreur réseau lors de l’initialisation de la commande',
      };
    }
  }

  // Server-side direct initiation
  const { moteurService } = await import('./moteur/service');
  const result = await moteurService.createCheckoutSession({
    companyId: params.companyId,
    planId: params.planId,
    billingCycle: params.billingCycle,
    moduleIds: params.moduleIds,
    country: params.country || 'CI',
    amount: params.amount,
    currency: params.currency || 'XOF',
    referralCode: params.referralCode,
  });

  return {
    success: result.success,
    status: result.status,
    reference: result.reference,
    sessionId: result.sessionId,
    invoiceId: `INV-${result.reference}`,
    checkoutUrl: result.checkoutUrl,
    error: result.errorMessage,
  };
}

/**
 * Fetch billing payment history
 */
export async function getPaymentHistory(companyId: string): Promise<PaymentHistoryItem[]> {
  if (isSupabaseConfigured()) {
    const supabase: any = typeof window !== 'undefined' ? createBrowserClient() : createServerClient();
    if (supabase) {
      const { data } = await supabase
        .from('payment_history')
        .select('*')
        .eq('company_id', companyId)
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        return data.map((p: any) => ({
          id: p.id,
          invoiceNumber: `INV-${p.id.slice(0, 8).toUpperCase()}`,
          companyId: p.company_id,
          date: p.created_at,
          amount: p.amount,
          currency: p.currency,
          planName: p.description,
          moduleCount: 1,
          paymentMethod: 'mobile_money',
          operator: 'Mobile Money',
          status: p.status as PaymentHistoryItem['status'],
          receiptUrl: p.invoice_url || '#',
        }));
      }
    }
  }

  const store = getStore();
  return store.payments
    .filter((p) => p.companyId === companyId || !p.companyId || companyId === '11111111-1111-4111-8111-111111111111')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

/**
 * Marks a subscription as expired
 */
export async function expireSubscription(companyId: string): Promise<Subscription | null> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      await supabase
        .from('subscriptions')
        .update({ status: 'suspended' })
        .eq('company_id', companyId);
    }
  }

  const store = getStore();
  const subIdx = store.subscriptions.findIndex((s) => s.companyId === companyId);
  if (subIdx === -1) return null;

  store.subscriptions[subIdx].status = 'expired';
  setStoreItem('SUBSCRIPTIONS', store.subscriptions);

  const sub = store.subscriptions[subIdx];

  for (const modId of sub.includedModuleIds) {
    await dispatchWebhookEvent(
      'subscription.expired',
      {
        workspaceId: companyId,
        planId: sub.planId,
        expiredAt: new Date().toISOString(),
      },
      modId
    );
  }

  return sub;
}

/**
 * Cancels a subscription
 */
export async function cancelSubscription(companyId: string): Promise<Subscription | null> {
  if (isSupabaseConfigured() && typeof window !== 'undefined') {
    const supabase: any = createBrowserClient();
    if (supabase) {
      await supabase
        .from('subscriptions')
        .update({ status: 'cancelled', cancel_at_period_end: true })
        .eq('company_id', companyId);
    }
  }

  const store = getStore();
  const subIdx = store.subscriptions.findIndex((s) => s.companyId === companyId);
  if (subIdx === -1) return null;

  store.subscriptions[subIdx].status = 'canceled';
  store.subscriptions[subIdx].autoRenew = false;
  setStoreItem('SUBSCRIPTIONS', store.subscriptions);

  const sub = store.subscriptions[subIdx];

  for (const modId of sub.includedModuleIds) {
    await dispatchWebhookEvent(
      'subscription.expired',
      {
        workspaceId: companyId,
        planId: sub.planId,
        canceledAt: new Date().toISOString(),
      },
      modId
    );
  }

  return sub;
}

