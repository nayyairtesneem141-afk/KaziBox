import { Plan, Subscription, PaymentHistoryItem } from '@kazibox/sdk';
import { getStore, setStoreItem } from './storage';
import { notifySubscriptionActivated, notifyPaymentFailed } from './notifications';

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
 * In Supabase: const { data } = await supabase.from('plans').select('*');
 */
export async function getPlans(): Promise<Plan[]> {
  return PLANS;
}

/**
 * Fetch active or latest subscription for current workspace
 * In Supabase: const { data } = await supabase.from('subscriptions').select('*').eq('company_id', companyId).order('created_at', { ascending: false }).limit(1).single();
 */
export async function getSubscription(companyId: string): Promise<Subscription | null> {
  const store = getStore();
  const sub = store.subscriptions.find((s) => s.companyId === companyId);
  return sub || null;
}

export interface CheckoutParams {
  companyId: string;
  planId: string;
  billingCycle: 'monthly' | 'yearly';
  moduleIds: string[];
  paymentMethod: 'mobile_money' | 'card';
  operator?: string;
  phoneNumber?: string;
  cardName?: string;
  cardNumber?: string;
  cardExpiry?: string;
  cardCvc?: string;
  amount: number;
  currency?: string;
}

/**
 * Start checkout stub for centralized billing
 * Simulates mobile money push (pawaPay) or card charge (Stripe/Paystack)
 */
export async function startCheckout(params: CheckoutParams): Promise<{
  success: boolean;
  subscription?: Subscription;
  invoiceId?: string;
  error?: string;
}> {
  // Simulate payment gateway delay (e.g. mobile money USSD prompt)
  await new Promise((resolve) => setTimeout(resolve, 800));

  // =========================================================================
  // INTEGRATION POINTS FOR REAL PAYMENT GATEWAYS:
  // =========================================================================
  if (params.paymentMethod === 'mobile_money') {
    // TODO: Connect pawaPay Mobile Money API here (POST /v1/charges)
    // Payload contract:
    // {
    //   depositId: `dep_${Date.now()}`,
    //   amount: params.amount.toString(),
    //   currency: params.currency || 'XOF',
    //   correspondent: params.operator, // e.g., 'ORANGE_CIV', 'MTN_CIV', 'WAVE_CIV'
    //   payer: { msisdn: params.phoneNumber?.replace(/\D/g, '') },
    //   customerTimestamp: new Date().toISOString()
    // }
    console.log('[MOCK GATEWAY] pawaPay charge submitted:', {
      operator: params.operator,
      phone: params.phoneNumber,
      amount: params.amount,
    });
  } else {
    // TODO: Connect Card provider (Stripe / Paystack) here
    // Payload contract:
    // await stripe.paymentIntents.create({
    //   amount: params.amount * 100,
    //   currency: (params.currency || 'XOF').toLowerCase(),
    //   payment_method_data: { type: 'card', ... }
    // });
    console.log('[MOCK GATEWAY] Card provider charge submitted:', {
      last4: params.cardNumber?.slice(-4),
      amount: params.amount,
    });
  }
  // =========================================================================

  const store = getStore();
  const invoiceNumber = `INV-${new Date().getFullYear()}-${Math.floor(100 + Math.random() * 900)}`;

  const now = new Date();
  const nextPeriod = new Date(now);
  if (params.billingCycle === 'yearly') {
    nextPeriod.setFullYear(nextPeriod.getFullYear() + 1);
  } else {
    nextPeriod.setMonth(nextPeriod.getMonth() + 1);
  }

  const updatedSubscription: Subscription = {
    id: `sub-${Date.now()}`,
    companyId: params.companyId,
    planId: params.planId,
    status: 'active',
    billingCycle: params.billingCycle,
    includedModuleIds: params.moduleIds,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: nextPeriod.toISOString(),
    renewAt: nextPeriod.toISOString(),
    autoRenew: true,
    amount: params.amount,
    currency: params.currency || 'XOF',
  };

  // Upsert subscription in persistent mock store
  const existingIdx = store.subscriptions.findIndex((s) => s.companyId === params.companyId);
  if (existingIdx !== -1) {
    store.subscriptions[existingIdx] = updatedSubscription;
  } else {
    store.subscriptions.push(updatedSubscription);
  }
  setStoreItem('SUBSCRIPTIONS', store.subscriptions);

  // Add payment history record
  const planObj = PLANS.find((p) => p.id === params.planId);
  const planTitle = typeof planObj?.name === 'string' ? planObj.name : planObj?.name?.fr || params.planId;

  const newPayment: PaymentHistoryItem = {
    id: `pay-${Date.now()}`,
    invoiceNumber,
    companyId: params.companyId,
    date: now.toISOString(),
    amount: params.amount,
    currency: params.currency || 'XOF',
    planName: `Formule ${planTitle} (${params.billingCycle === 'yearly' ? 'Annuel' : 'Mensuel'})`,
    moduleCount: params.moduleIds.length,
    paymentMethod: params.paymentMethod,
    operator: params.paymentMethod === 'mobile_money' ? params.operator || 'Mobile Money' : 'Carte Bancaire',
    status: 'paid',
    receiptUrl: '#',
  };

  store.payments.unshift(newPayment);
  setStoreItem('PAYMENTS', store.payments);

  // Trigger in-app notification
  await notifySubscriptionActivated(params.companyId, planTitle);

  return {
    success: true,
    subscription: updatedSubscription,
    invoiceId: invoiceNumber,
  };
}

/**
 * Fetch billing payment history
 * In Supabase: const { data } = await supabase.from('payments').select('*').eq('company_id', companyId).order('date', { ascending: false });
 */
export async function getPaymentHistory(companyId: string): Promise<PaymentHistoryItem[]> {
  const store = getStore();
  return store.payments
    .filter((p) => p.companyId === companyId || !p.companyId || companyId === 'ws-palmeraie-01')
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
