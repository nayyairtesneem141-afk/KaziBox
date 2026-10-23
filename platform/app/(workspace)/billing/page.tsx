'use client';

import React, { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Card, Button, Badge, Input, Select } from '@kazibox/ui';
import { useSession } from '@/lib/useSession';
import { useTranslation, localize } from '@/lib/i18n';
import { platformConfig } from '@/config';
import {
  getPlans,
  getSubscription,
  getPaymentHistory,
  startCheckout,
} from '@/lib/billing';
import { getModules } from '@/lib/modules';
import { Plan, Subscription, PaymentHistoryItem, ModuleManifest } from '@kazibox/sdk';

function BillingPageContent() {
  const searchParams = useSearchParams();
  const preselectedModule = searchParams.get('module');
  const requestedAction = searchParams.get('action'); // 'renew' | 'upgrade'
  const preselectedPlan = searchParams.get('plan') || 'single';
  const checkoutId = searchParams.get('checkout_id');
  const returnStatus = searchParams.get('status');
  const returnProvider = searchParams.get('provider');

  const { user, workspace } = useSession();
  const { t, language } = useTranslation();

  const role = user?.role || 'worker';
  const isOwner = role === 'owner' || role === 'platform_admin';

  const [activeTab, setActiveTab] = useState<'subscription' | 'plans'>(
    preselectedModule || requestedAction ? 'plans' : 'subscription'
  );

  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [paymentHistory, setPaymentHistory] = useState<PaymentHistoryItem[]>([]);
  const [modules, setModules] = useState<ModuleManifest[]>([]);
  const [loading, setLoading] = useState(true);

  // Checkout State
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(preselectedPlan);
  const [selectedModuleIds, setSelectedModuleIds] = useState<string[]>(
    preselectedModule ? [preselectedModule] : ['hotel-property']
  );

  // Payment Form State
  const [country, setCountry] = useState<'CI' | 'SN' | 'CM' | 'CD'>('CI');
  const [referralCode, setReferralCode] = useState('');
  const [pendingReference, setPendingReference] = useState('');
  const [moteurReady, setMoteurReady] = useState(true);
  const [paymentMethod, setPaymentMethod] = useState<'mobile_money' | 'card'>('mobile_money');
  const [operator, setOperator] = useState('Wave');
  const [phoneNumber, setPhoneNumber] = useState('+225 07 12 34 56');
  const [cardNumber, setCardNumber] = useState('4242 •••• •••• 4242');
  const [cardExpiry, setCardExpiry] = useState('12/28');
  const [cardCvc, setCardCvc] = useState('123');
  const [cardName, setCardName] = useState(user?.name || 'Mamadou Diallo');

  // Checkout Stages: 'form' | 'waiting' | 'success'
  const [checkoutStage, setCheckoutStage] = useState<'form' | 'waiting' | 'success'>('form');
  const [successInvoiceId, setSuccessInvoiceId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPollingTimeout, setIsPollingTimeout] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [pollingErrorCount, setPollingErrorCount] = useState(0);

  const loadData = async () => {
    if (!workspace) return;
    const [p, s, h, m] = await Promise.all([
      getPlans(),
      getSubscription(workspace.company_id),
      getPaymentHistory(workspace.company_id),
      getModules(),
    ]);
    setPlans(p);
    setSubscription(s);
    setPaymentHistory(h);
    setModules(m.filter((mod) => mod.status === 'published'));

    if (s && !preselectedModule && !requestedAction) {
      setSelectedModuleIds(s.includedModuleIds || []);
      setSelectedPlanId(s.planId || 'single');
    }

    try {
      const cfgRes = await fetch('/api/v1/billing/config');
      if (cfgRes.ok) {
        const cfgData = await cfgRes.json();
        setMoteurReady(Boolean(cfgData.moteurReady));
      }
    } catch {
      // Keep default
    }

    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, [workspace]);

  // Centralized payment status check with trusted backend verification
  const checkStatus = async (ref: string): Promise<boolean> => {
    if (!ref) return false;
    try {
      const res = await fetch(`/api/v1/billing/status?reference=${encodeURIComponent(ref)}`, {
        credentials: 'include',
      });
      if (!res.ok) {
        setPollingErrorCount((prev) => prev + 1);
        return false;
      }
      const data = await res.json();
      const rawStatus = String(data.status || '').toLowerCase();

      if (rawStatus === 'succeeded' || rawStatus === 'completed' || rawStatus === 'paid') {
        const inv = data.invoiceId || (ref.startsWith('INV-') ? ref : `INV-${ref}`);
        setSuccessInvoiceId(inv);
        setCheckoutStage('success');
        setIsPollingTimeout(false);
        setPendingReference('');
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('kazibox_pending_checkout');
        }
        await loadData();
        return true;
      } else if (
        rawStatus === 'failed' ||
        rawStatus === 'cancelled' ||
        rawStatus === 'rejected' ||
        rawStatus === 'expired'
      ) {
        setCheckoutStage('form');
        setIsPollingTimeout(false);
        setPendingReference('');
        if (typeof window !== 'undefined') {
          sessionStorage.removeItem('kazibox_pending_checkout');
        }
        alert(data.errorMessage || data.message || t('billing.payment_failed'));
        return true;
      }
      return false; // Still pending
    } catch {
      setPollingErrorCount((prev) => prev + 1);
      return false;
    }
  };

  // Recover pending checkout state across page refresh from persisted storage
  useEffect(() => {
    if (typeof window === 'undefined') return;

    try {
      const stored = sessionStorage.getItem('kazibox_pending_checkout');
      if (stored) {
        const parsed = JSON.parse(stored);
        const ageMs = Date.now() - (parsed.timestamp || 0);
        // Recover if session is younger than 15 minutes
        if (parsed.reference && ageMs < 15 * 60 * 1000) {
          setPendingReference(parsed.reference);
          setCheckoutStage('waiting');
          // Run immediate active check
          checkStatus(parsed.reference).then((isTerminal) => {
            if (!isTerminal) {
              setIsPollingTimeout(false);
            }
          });
        } else {
          sessionStorage.removeItem('kazibox_pending_checkout');
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Handle return from interactive checkout redirect with trusted verification
  useEffect(() => {
    const targetRef = checkoutId || searchParams.get('reference') || pendingReference;
    if (returnStatus && targetRef) {
      setCheckoutStage('waiting');
      setPendingReference(targetRef);
      checkStatus(targetRef);
      if (typeof window !== 'undefined' && window.history.replaceState) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
      }
    }
  }, [returnStatus, checkoutId]);

  // Handle plan calculation
  const publishedModules = modules.filter((m) => m.status === 'published');
  const unitRateMonthly = 13000;
  const unitRateYearly = 130000;

  const calculateTotal = (): number => {
    if (selectedPlanId === 'all_access') {
      return billingCycle === 'yearly' ? 550000 : 55000;
    }
    if (selectedPlanId === 'bundle') {
      return billingCycle === 'yearly' ? 350000 : 35000;
    }
    if (selectedPlanId === 'single') {
      return billingCycle === 'yearly' ? 150000 : 15000;
    }
    // Custom "Build your own"
    const count = Math.max(1, selectedModuleIds.length);
    const rate = billingCycle === 'yearly' ? unitRateYearly : unitRateMonthly;
    return count * rate;
  };

  const handleModuleToggle = (modId: string) => {
    if (selectedPlanId === 'single') {
      setSelectedModuleIds([modId]);
      return;
    }

    if (selectedPlanId === 'bundle') {
      if (selectedModuleIds.includes(modId)) {
        if (selectedModuleIds.length > 1) {
          setSelectedModuleIds(selectedModuleIds.filter((id) => id !== modId));
        }
      } else {
        if (selectedModuleIds.length < 3) {
          setSelectedModuleIds([...selectedModuleIds, modId]);
        } else {
          alert(t('billing.bundle_limit'));
        }
      }
      return;
    }

    // Custom
    if (selectedModuleIds.includes(modId)) {
      if (selectedModuleIds.length > 1) {
        setSelectedModuleIds(selectedModuleIds.filter((id) => id !== modId));
      }
    } else {
      setSelectedModuleIds([...selectedModuleIds, modId]);
    }
  };

  // Status Polling Effect with timeout & terminal state management
  useEffect(() => {
    if (checkoutStage !== 'waiting' || !pendingReference || isPollingTimeout) return;

    let isMounted = true;
    let attempts = 0;
    const maxAttempts = 30; // 30 * 3s = 90s timeout

    const interval = setInterval(async () => {
      attempts += 1;
      const isTerminal = await checkStatus(pendingReference);
      if (!isMounted) return;

      if (isTerminal) {
        clearInterval(interval);
      } else if (attempts >= maxAttempts) {
        clearInterval(interval);
        setIsPollingTimeout(true);
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [checkoutStage, pendingReference, isPollingTimeout]);

  const handleCancelCheckout = () => {
    setCheckoutStage('form');
    setPendingReference('');
    setIsPollingTimeout(false);
    setPollingErrorCount(0);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('kazibox_pending_checkout');
      } catch {}
    }
  };

  const handleManualCheck = async () => {
    if (!pendingReference || isCheckingStatus) return;
    setIsCheckingStatus(true);
    try {
      const isTerminal = await checkStatus(pendingReference);
      if (!isTerminal) {
        alert("Le paiement est toujours en attente de validation par l'opérateur. Veuillez patienter quelques instants.");
      }
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleExecuteCheckout = async () => {
    if (!workspace || isSubmitting) return;

    setIsSubmitting(true);
    setIsPollingTimeout(false);
    setPollingErrorCount(0);

    const currencyMap: Record<string, string> = {
      CD: 'USD',
      CM: 'XAF',
      SN: 'XOF',
      CI: 'XOF',
    };

    try {
      const result = await startCheckout({
        companyId: workspace.company_id,
        planId: selectedPlanId,
        billingCycle,
        moduleIds: selectedPlanId === 'all_access' ? publishedModules.map((m) => m.id) : selectedModuleIds,
        paymentMethod,
        country,
        operator,
        phoneNumber,
        cardName,
        cardNumber,
        cardExpiry,
        cardCvc,
        amount: calculateTotal(),
        currency: currencyMap[country] || 'XOF',
        referralCode: referralCode.trim() || undefined,
      });

      if (result.success) {
        const ref = result.reference || `KZ-${Date.now()}`;
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.setItem(
              'kazibox_pending_checkout',
              JSON.stringify({
                reference: ref,
                timestamp: Date.now(),
                companyId: workspace.company_id,
                planId: selectedPlanId,
              })
            );
          } catch {}
        }

        if (result.checkoutUrl) {
          window.location.href = result.checkoutUrl;
          return;
        }

        setPendingReference(ref);
        setIsPollingTimeout(false);
        setCheckoutStage('waiting');
      } else {
        setPendingReference('');
        if (typeof window !== 'undefined') {
          try {
            sessionStorage.removeItem('kazibox_pending_checkout');
          } catch {}
        }
        alert(result.error || result.message || t('billing.payment_failed'));
        setCheckoutStage('form');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Rule: Workers and Managers cannot see Billing
  if (!isOwner) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-[#E5E7EB] text-center max-w-lg mx-auto mt-12 shadow-sm">
        <div className="w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 font-black text-2xl">
          🔒
        </div>
        <h2 className="text-xl font-bold text-[#1F2937] mb-2">
          {t('billing.restricted_title')}
        </h2>
        <p className="text-sm text-[#6B7280] leading-relaxed mb-6">
          {t('billing.restricted_desc')}
        </p>
        <Link href="/dashboard">
          <Button variant="outline" size="md">
            &larr; {t('placeholders.back_dashboard')}
          </Button>
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[400px] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-[#1F2937]">
            {t('billing.title')}
          </h1>
          <p className="text-sm sm:text-base text-[#6B7280] mt-0.5">
            {t('billing.subtitle')}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-[#F3F4F6] p-1.5 rounded-2xl border border-[#E5E7EB]">
          <button
            onClick={() => {
              setActiveTab('subscription');
              setCheckoutStage('form');
            }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'subscription'
                ? 'bg-white text-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                : 'text-[#6B7280] hover:text-[#1F2937]'
            }`}
          >
            📋 {t('billing.tab_my_subscription')}
          </button>
          <button
            onClick={() => setActiveTab('plans')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all min-h-[40px] ${
              activeTab === 'plans'
                ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white shadow-sm'
                : 'text-[#6B7280] hover:text-[#1F2937]'
            }`}
          >
            ⚡ {t('billing.tab_plans_checkout')}
          </button>
        </div>
      </div>

      {/* Strict Financial Separation Guarantee Banner */}
      <div className="p-4 bg-[var(--kazibox-primary-soft,#F3E8FF)] border border-[#DDD6FE] rounded-2xl flex items-start gap-3.5 shadow-sm">
        <div className="w-9 h-9 rounded-xl bg-[var(--kazibox-primary,#6D28D9)] text-white flex items-center justify-center shrink-0 font-black text-sm">
          ✓
        </div>
        <div className="text-xs sm:text-sm text-[#1F2937]">
          <p className="font-extrabold text-[var(--kazibox-primary,#6D28D9)]">
            {t('billing.separation_guarantee_title')}
          </p>
          <p className="text-[#4B5563] mt-0.5 leading-relaxed">
            {t('billing.separation_guarantee_desc')}
          </p>
        </div>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: MY SUBSCRIPTION & PAYMENT HISTORY */}
      {/* ==================================================================== */}
      {activeTab === 'subscription' && (
        <div className="space-y-6">
          {/* Current Subscription Card */}
          <Card padding="lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-[#E5E7EB] pb-6 mb-6">
              <div>
                <span className="text-xs font-bold text-[#6B7280] uppercase tracking-wider">
                  {t('billing.current_plan')}
                </span>
                <div className="flex items-center gap-3 mt-1">
                  <h3 className="text-2xl font-black text-[#1F2937]">
                    Formule {subscription?.planId?.toUpperCase() || 'STARTER'}
                  </h3>
                  <Badge
                    variant={subscription?.status === 'active' ? 'green' : 'yellow'}
                    size="md"
                  >
                    {subscription?.status === 'active'
                      ? t('common.active')
                      : t('billing.status_expired')}
                  </Badge>
                </div>
                <p className="text-xs sm:text-sm text-[#6B7280] mt-1">
                  {t('billing.workspace_consolidated_charge')} &bull;{' '}
                  {subscription?.billingCycle === 'yearly'
                    ? t('billing.yearly_cycle')
                    : t('billing.monthly_cycle')}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="md"
                  onClick={() => {
                    setActiveTab('plans');
                    setSelectedPlanId(subscription?.planId || 'single');
                  }}
                >
                  🔄 {t('billing.renew_subscription')}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => {
                    setActiveTab('plans');
                  }}
                >
                  ⚡ {t('billing.change_plan')}
                </Button>
              </div>
            </div>

            {/* Included Modules in this Workspace */}
            <div>
              <h4 className="text-sm font-bold text-[#1F2937] mb-3">
                {t('billing.included_modules_label')} (
                {subscription?.includedModuleIds?.length || 0}) :
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                {modules
                  .filter(
                    (m) =>
                      subscription?.planId === 'all_access' ||
                      subscription?.includedModuleIds?.includes(m.id)
                  )
                  .map((mod) => (
                    <div
                      key={mod.id}
                      className="p-3 rounded-2xl border border-[#E5E7EB] bg-[#F9FAFB] flex items-center justify-between"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <span className="text-xl">{mod.logo}</span>
                        <div className="truncate">
                          <p className="text-xs font-bold text-[#1F2937] truncate">
                            {localize(mod.name, language)}
                          </p>
                          <span className="text-[10px] text-[#059669] font-semibold">
                            ✓ {t('billing.included')}
                          </span>
                        </div>
                      </div>
                      <Link href={`/modules/${mod.slug}`}>
                        <Button variant="outline" size="sm" className="text-[11px] px-2 py-1 h-7 min-h-0">
                          {t('my_modules.open_button')}
                        </Button>
                      </Link>
                    </div>
                  ))}
              </div>

              <div className="mt-6 pt-4 border-t border-[#E5E7EB] flex flex-col sm:flex-row sm:items-center justify-between text-xs text-[#6B7280] gap-2">
                <span>
                  {t('billing.next_renewal_label')} :{' '}
                  <strong className="text-[#1F2937]">
                    {subscription?.renewAt
                      ? new Date(subscription.renewAt).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US')
                      : '01/11/2026'}
                  </strong>
                </span>
                <span>
                  {t('billing.payment_channel_label')} :{' '}
                  <strong className="text-[#1F2937]">Mobile Money / Card</strong>
                </span>
              </div>
            </div>
          </Card>

          {/* Payment History Table (6 rows) */}
          <Card padding="lg">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-bold text-[#1F2937]">
                  {t('billing.history_title')}
                </h3>
                <p className="text-xs text-[#6B7280]">
                  {t('billing.history_subtitle')}
                </p>
              </div>
              <Badge variant="purple" size="sm">
                {paymentHistory.length} {t('billing.invoices_count')}
              </Badge>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-[#E5E7EB] text-[#6B7280] text-[11px] uppercase tracking-wider font-bold">
                    <th className="py-3 px-2">{t('billing.invoice')}</th>
                    <th className="py-3 px-2">{t('billing.date')}</th>
                    <th className="py-3 px-2">{t('billing.plan')}</th>
                    <th className="py-3 px-2">{t('billing.method')}</th>
                    <th className="py-3 px-2 text-right">{t('billing.amount')}</th>
                    <th className="py-3 px-2 text-center">{t('billing.status')}</th>
                    <th className="py-3 px-2 text-right">{t('billing.receipt')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F3F4F6]">
                  {paymentHistory.map((row) => (
                    <tr key={row.id} className="hover:bg-[#F9FAFB] transition-colors">
                      <td className="py-3 px-2 font-mono font-bold text-[#1F2937]">
                        {row.invoiceNumber}
                      </td>
                      <td className="py-3 px-2 text-[#4B5563]">
                        {new Date(row.date).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-US')}
                      </td>
                      <td className="py-3 px-2 font-medium text-[#1F2937]">
                        {localize(row.planName, language)}
                      </td>
                      <td className="py-3 px-2 text-[#4B5563]">
                        <span className="font-semibold">{row.operator}</span>
                      </td>
                      <td className="py-3 px-2 text-right font-black text-[#1F2937]">
                        {row.amount.toLocaleString()} {row.currency}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <Badge
                          variant={row.status === 'paid' ? 'green' : 'gray'}
                          size="sm"
                        >
                          {row.status === 'paid' ? (language === 'fr' ? 'Payé' : 'Paid') : (language === 'fr' ? 'Échoué' : 'Failed')}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-right">
                        <button
                          onClick={() => alert(`${t('billing.download_pdf')} : ${row.invoiceNumber}`)}
                          className="text-[var(--kazibox-primary,#6D28D9)] font-bold text-xs hover:underline cursor-pointer"
                        >
                          PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: PLANS SELECTION & LIVE CHECKOUT */}
      {/* ==================================================================== */}
      {activeTab === 'plans' && (
        <div className="space-y-8">
          {/* Waiting for approval overlay */}
          {checkoutStage === 'waiting' && (
            <Card padding="lg" className="text-center py-16 max-w-xl mx-auto border-2 border-[var(--kazibox-primary,#6D28D9)]">
              {isPollingTimeout ? (
                <>
                  <div className="w-20 h-20 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center text-3xl mx-auto mb-6">
                    ⏳
                  </div>
                  <Badge variant="yellow" size="md" className="mb-3">
                    Délai de confirmation dépassé
                  </Badge>
                  <h3 className="text-2xl font-black text-[#1F2937] mb-2">
                    Confirmation en cours
                  </h3>
                  <p className="text-sm text-[#4B5563] max-w-md mx-auto leading-relaxed mb-4">
                    La confirmation prend plus de temps que prévu auprès de votre opérateur. Si vous avez validé la transaction sur votre téléphone, cliquez ci-dessous pour actualiser l'état. Vos modules seront débloqués dès confirmation.
                  </p>
                  <p className="text-xs text-[#6B7280] max-w-md mx-auto leading-relaxed mb-6">
                    Référence : <span className="font-mono font-bold text-gray-700">{pendingReference}</span>
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <Button
                      variant="primary"
                      size="md"
                      onClick={handleManualCheck}
                      disabled={isCheckingStatus}
                    >
                      {isCheckingStatus ? 'Vérification...' : '🔄 Vérifier à nouveau'}
                    </Button>
                    <Button
                      variant="outline"
                      size="md"
                      onClick={handleCancelCheckout}
                    >
                      Annuler / Modifier
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-full bg-[var(--kazibox-primary-soft,#F3E8FF)] text-[var(--kazibox-primary,#6D28D9)] flex items-center justify-center text-3xl mx-auto mb-6 animate-pulse">
                    ⚡
                  </div>
                  <Badge variant="purple" size="md" className="mb-3">
                    {t('billing.moteur_infrastructure_label')}
                  </Badge>
                  <h3 className="text-2xl font-black text-[#1F2937] mb-2">
                    {t('billing.waiting_approval_title')}
                  </h3>
                  <p className="text-sm text-[#4B5563] max-w-md mx-auto leading-relaxed mb-4">
                    {paymentMethod === 'mobile_money'
                      ? `Une demande de paiement sécurisée de ${calculateTotal().toLocaleString()} ${country === 'CD' ? 'USD' : (country === 'CM' ? 'XAF' : 'XOF')} (Libellé: KaziBox) a été initiée via Moteur au ${phoneNumber}.`
                      : `Traitement sécurisé de votre carte bancaire ${cardNumber.slice(-4)} via l'infrastructure Moteur...`}
                  </p>
                  <p className="text-xs text-[#6B7280] max-w-md mx-auto leading-relaxed mb-6">
                    En attente de la confirmation cryptographique du paiement. Vos modules seront débloqués dès validation.
                  </p>
                  <div className="w-12 h-12 border-4 border-[var(--kazibox-primary,#6D28D9)] border-t-transparent rounded-full animate-spin mx-auto mb-6" />
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCancelCheckout}
                    >
                      Annuler / Modifier
                    </Button>
                  </div>
                </>
              )}
            </Card>
          )}

          {/* Success screen */}
          {checkoutStage === 'success' && (
            <Card padding="lg" className="text-center py-16 max-w-xl mx-auto border-2 border-emerald-500">
              <div className="w-20 h-20 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center text-4xl mx-auto mb-6">
                ✓
              </div>
              <Badge variant="green" size="md" className="mb-2">
                Facture {successInvoiceId} &bull; Validée
              </Badge>
              <h3 className="text-2xl font-black text-[#1F2937] mb-2">
                {t('billing.success_title')}
              </h3>
              <p className="text-sm text-[#4B5563] max-w-md mx-auto leading-relaxed mb-8">
                {t('billing.success_desc')}
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/modules/my-modules">
                  <Button variant="primary" size="lg">
                    🚀 {t('nav.my_modules')} &rarr;
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => {
                    setCheckoutStage('form');
                    setActiveTab('subscription');
                  }}
                >
                  {t('billing.tab_my_subscription')}
                </Button>
              </div>
            </Card>
          )}

          {/* Main Checkout Form & Plan Chooser */}
          {checkoutStage === 'form' && (
            <div className="space-y-8">
              {/* Monthly / Yearly Toggle with discount */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-center gap-3 text-center">
                <div className="inline-flex items-center bg-white p-1 rounded-2xl border border-[#E5E7EB] shadow-sm">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`px-5 py-2.5 rounded-xl font-black text-xs transition-all min-h-[42px] ${
                      billingCycle === 'monthly'
                        ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white shadow-sm'
                        : 'text-[#6B7280] hover:text-[#1F2937]'
                    }`}
                  >
                    {t('billing.monthly')}
                  </button>
                  <button
                    onClick={() => setBillingCycle('yearly')}
                    className={`px-5 py-2.5 rounded-xl font-black text-xs transition-all min-h-[42px] flex items-center gap-2 ${
                      billingCycle === 'yearly'
                        ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white shadow-sm'
                        : 'text-[#6B7280] hover:text-[#1F2937]'
                    }`}
                  >
                    <span>{t('billing.yearly')}</span>
                    <span className="text-[10px] bg-[#FACC15] text-[#1F2937] font-extrabold px-1.5 py-0.5 rounded-full">
                      -20% ({t('billing.two_months_free')})
                    </span>
                  </button>
                </div>
              </div>

              {/* 4 Plans Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {plans.map((p) => {
                  const planName = localize(p.name, language) || p.id;
                  const planDesc = localize(p.description, language);

                  const isSelected = selectedPlanId === p.id;
                  const price =
                    p.id === 'custom'
                      ? billingCycle === 'yearly'
                        ? unitRateYearly * Math.max(1, selectedModuleIds.length)
                        : unitRateMonthly * Math.max(1, selectedModuleIds.length)
                      : billingCycle === 'yearly'
                      ? p.yearlyPrice
                      : p.monthlyPrice;

                  return (
                    <div
                      key={p.id}
                      onClick={() => setSelectedPlanId(p.id)}
                      className={`cursor-pointer rounded-2xl p-5 border-2 transition-all flex flex-col justify-between ${
                        isSelected
                          ? 'border-[var(--kazibox-primary,#6D28D9)] bg-white shadow-lg ring-2 ring-[var(--kazibox-primary-soft,#F3E8FF)]'
                          : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-black uppercase text-[#6B7280]">
                            {localize(p.badge, language)}
                          </span>
                          {p.isPopular && (
                            <Badge variant="yellow" size="sm">
                              Populaire
                            </Badge>
                          )}
                        </div>

                        <h4 className="text-lg font-black text-[#1F2937] mb-1">
                          {planName}
                        </h4>
                        <p className="text-xs text-[#6B7280] mb-4 min-h-[32px] leading-relaxed">
                          {planDesc}
                        </p>

                        <div className="mb-4">
                          <div className="text-2xl font-black text-[#1F2937]">
                            {price.toLocaleString()} XOF
                          </div>
                          <span className="text-[11px] text-[#9CA3AF]">
                            / {billingCycle === 'yearly' ? 'an' : 'mois'}
                          </span>
                        </div>

                        {/* Features bullet list */}
                        <div className="space-y-1.5 text-xs text-[#4B5563] pt-3 border-t border-[#E5E7EB]">
                          {p.features.map((feat, idx) => {
                            const featStr = localize(feat, language);
                            return (
                              <div key={idx} className="flex items-center gap-1.5">
                                <span className="text-[var(--kazibox-primary,#6D28D9)] font-bold">✓</span>
                                <span className="truncate">{featStr}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="mt-5 pt-3">
                        <Button
                          variant={isSelected ? 'primary' : 'outline'}
                          size="sm"
                          className="w-full text-xs font-bold"
                        >
                          {isSelected ? '✓ Sélectionné' : 'Choisir cette formule'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Module Selector & Live Total Calculator */}
              <Card padding="lg">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E5E7EB]">
                  <div>
                    <h3 className="text-lg font-bold text-[#1F2937]">
                      {selectedPlanId === 'all_access'
                        ? 'Tous les modules du catalogue inclus'
                        : selectedPlanId === 'single'
                        ? 'Sélectionnez votre module unique'
                        : selectedPlanId === 'bundle'
                        ? 'Sélectionnez jusqu’à 3 modules'
                        : 'Choisissez vos modules à la carte (Total en direct)'}
                    </h3>
                    <p className="text-xs text-[#6B7280]">
                      {selectedPlanId === 'custom'
                        ? `Tarif dégressif de ${unitRateMonthly.toLocaleString()} XOF/mois par module actif.`
                        : 'Vos modules s’intègrent automatiquement dans votre espace dès la validation.'}
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-xs text-[#6B7280] block">Total sélectionné</span>
                    <span className="text-2xl font-black text-[var(--kazibox-primary,#6D28D9)]">
                      {calculateTotal().toLocaleString()} XOF
                    </span>
                  </div>
                </div>

                {/* Module selection checkboxes */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {publishedModules.map((m) => {
                    const isChecked =
                      selectedPlanId === 'all_access' || selectedModuleIds.includes(m.id);
                    const disabled = selectedPlanId === 'all_access';

                    return (
                      <div
                        key={m.id}
                        onClick={() => !disabled && handleModuleToggle(m.id)}
                        className={`p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${
                          disabled
                            ? 'bg-purple-50/50 border-purple-200 cursor-default'
                            : isChecked
                            ? 'border-[var(--kazibox-primary,#6D28D9)] bg-[#FDF8F0] shadow-sm cursor-pointer'
                            : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-3 truncate">
                          <span className="text-2xl">{m.logo}</span>
                          <div className="truncate">
                            <p className="text-xs font-bold text-[#1F2937] truncate">
                              {localize(m.name, language)}
                            </p>
                            <span className="text-[10px] text-[#6B7280]">
                              {m.pricePerMonth?.amount.toLocaleString()} {m.pricePerMonth?.currency}/mois
                            </span>
                          </div>
                        </div>

                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={disabled}
                          readOnly
                          className="w-4 h-4 rounded text-[var(--kazibox-primary,#6D28D9)] focus:ring-[var(--kazibox-primary,#6D28D9)]"
                        />
                      </div>
                    );
                  })}
                </div>
              </Card>

              {/* Order Summary & Payment Method Selector */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: Order Summary */}
                <Card padding="lg">
                  <h3 className="text-lg font-bold text-[#1F2937] mb-4">
                    {t('billing.order_summary_title')}
                  </h3>

                  <div className="space-y-3 text-xs sm:text-sm divide-y divide-[#E5E7EB]">
                    <div className="pt-2 flex justify-between">
                      <span className="text-[#6B7280]">Formule retenue</span>
                      <strong className="text-[#1F2937] uppercase">{selectedPlanId}</strong>
                    </div>

                    <div className="pt-2 flex justify-between">
                      <span className="text-[#6B7280]">Cycle de facturation</span>
                      <strong className="text-[#1F2937]">
                        {billingCycle === 'yearly' ? 'Annuel (2 mois offerts)' : 'Mensuel'}
                      </strong>
                    </div>

                    <div className="pt-2 flex justify-between">
                      <span className="text-[#6B7280]">Modules inclus</span>
                      <strong className="text-[#1F2937]">
                        {selectedPlanId === 'all_access'
                          ? 'Tous les modules'
                          : `${selectedModuleIds.length} module(s)`}
                      </strong>
                    </div>

                    <div className="pt-2 flex justify-between">
                      <span className="text-[#6B7280]">Sous-total</span>
                      <span className="text-[#1F2937]">
                        {calculateTotal().toLocaleString()} XOF
                      </span>
                    </div>

                    {billingCycle === 'yearly' && (
                      <div className="pt-2 flex justify-between text-emerald-600 font-bold">
                        <span>Remise Annuelle KaziBox</span>
                        <span>Inclus (-20%)</span>
                      </div>
                    )}

                    <div className="pt-3 flex justify-between text-base font-black text-[#1F2937]">
                      <span>Total à payer</span>
                      <span className="text-[var(--kazibox-primary,#6D28D9)]">
                        {calculateTotal().toLocaleString()} XOF
                      </span>
                    </div>
                  </div>
                </Card>

                {/* Right: Payment Method & Execution */}
                <Card padding="lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-[#1F2937]">
                      {t('billing.payment_method_title')}
                    </h3>
                    <Badge variant="purple" size="sm">
                      Moteur
                    </Badge>
                  </div>

                  {/* Priority Country Selector */}
                  <div className="mb-5">
                    <label className="text-xs font-bold text-[#374151] mb-1.5 block">
                      {t('billing.country_label')} :
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { code: 'CI', name: 'Côte d’Ivoire', cur: 'XOF' },
                        { code: 'SN', name: 'Sénégal', cur: 'XOF' },
                        { code: 'CM', name: 'Cameroun', cur: 'XAF' },
                        { code: 'CD', name: 'RDC Congo', cur: 'USD' },
                      ].map((c) => (
                        <button
                          key={c.code}
                          type="button"
                          onClick={() => setCountry(c.code as any)}
                          className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all text-center ${
                            country === c.code
                              ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white border-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                              : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-gray-50'
                          }`}
                        >
                          <div className="truncate">{c.name}</div>
                          <div className="text-[10px] opacity-80">{c.cur}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Payment Description & Infrastructure Badge */}
                  <div className="p-3 bg-[#F9FAFB] rounded-xl border border-[#E5E7EB] text-xs text-[#4B5563] mb-5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{t('billing.payment_description_label')} :</span>
                      <Badge variant="purple" size="sm">KaziBox</Badge>
                    </div>
                    <p className="text-[11px] text-[#6B7280]">
                      {t('billing.moteur_provider_note')}
                    </p>
                  </div>

                  {/* Method Picker Tabs */}
                  <div className="grid grid-cols-2 gap-3 mb-5">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('mobile_money')}
                      className={`p-3 rounded-2xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-2 min-h-[44px] ${
                        paymentMethod === 'mobile_money'
                          ? 'border-[var(--kazibox-primary,#6D28D9)] bg-[#FDF8F0] text-[var(--kazibox-primary,#6D28D9)]'
                          : 'border-[#E5E7EB] text-[#6B7280]'
                      }`}
                    >
                      <span>📱</span>
                      <span>Mobile Money</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('card')}
                      className={`p-3 rounded-2xl border-2 text-xs font-bold transition-all flex items-center justify-center gap-2 min-h-[44px] ${
                        paymentMethod === 'card'
                          ? 'border-[var(--kazibox-primary,#6D28D9)] bg-[#FDF8F0] text-[var(--kazibox-primary,#6D28D9)]'
                          : 'border-[#E5E7EB] text-[#6B7280]'
                      }`}
                    >
                      <span>💳</span>
                      <span>Carte Bancaire</span>
                    </button>
                  </div>

                  {/* Mobile Money Details */}
                  {paymentMethod === 'mobile_money' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-bold text-[#374151] mb-1.5 block">
                          Opérateur Mobile Money :
                        </label>
                        <div className="grid grid-cols-4 gap-2">
                          {['Wave', 'Orange', 'MTN', 'Moov'].map((op) => (
                            <button
                              key={op}
                              type="button"
                              onClick={() => setOperator(op)}
                              className={`py-2 px-1 rounded-xl text-xs font-black border transition-all ${
                                operator === op
                                  ? 'bg-[var(--kazibox-primary,#6D28D9)] text-white border-[var(--kazibox-primary,#6D28D9)] shadow-sm'
                                  : 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-gray-50'
                              }`}
                            >
                              {op}
                            </button>
                          ))}
                        </div>
                      </div>

                      <Input
                        label="Numéro de téléphone Mobile Money"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="+225 07 00 00 00"
                        helperText="Validation sécurisée via l'infrastructure Moteur."
                      />
                    </div>
                  ) : (
                    /* Card Details */
                    <div className="space-y-4">
                      <Input
                        label="Nom sur la carte"
                        value={cardName}
                        onChange={(e) => setCardName(e.target.value)}
                        placeholder="Mamadou Diallo"
                      />
                      <Input
                        label="Numéro de carte Visa / Mastercard"
                        value={cardNumber}
                        onChange={(e) => setCardNumber(e.target.value)}
                        placeholder="4242 4242 4242 4242"
                      />
                      <div className="grid grid-cols-2 gap-3">
                        <Input
                          label="Expiration (MM/AA)"
                          value={cardExpiry}
                          onChange={(e) => setCardExpiry(e.target.value)}
                          placeholder="12/28"
                        />
                        <Input
                          label="CVC / Cryptogramme"
                          value={cardCvc}
                          onChange={(e) => setCardCvc(e.target.value)}
                          placeholder="123"
                        />
                      </div>
                    </div>
                  )}

                  {/* Referral Code (Preserves Attribution for Moteur) */}
                  <div className="mt-4 pt-3 border-t border-[#E5E7EB]">
                    <Input
                      label={t('billing.referral_code_label')}
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value)}
                      placeholder={t('billing.referral_code_placeholder')}
                      helperText="Attribution transmise à Moteur pour la gestion des commissions partenaires."
                    />
                  </div>

                  {/* Submission CTA */}
                  <div className="mt-6 pt-4 border-t border-[#E5E7EB]">
                    {!moteurReady && (
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 mb-4 leading-relaxed">
                        <div className="font-bold flex items-center gap-1.5 mb-1">
                          <span>⚠️</span>
                          <span>{t('billing.moteur_infrastructure_label')}</span>
                        </div>
                        <p>{t('billing.moteur_pending_notice')}</p>
                      </div>
                    )}

                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full font-black text-sm min-h-[48px]"
                      onClick={handleExecuteCheckout}
                      disabled={isSubmitting}
                    >
                      {isSubmitting ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Initialisation du paiement...</span>
                        </div>
                      ) : (
                        `Payer ${calculateTotal().toLocaleString()} ${country === 'CD' ? 'USD' : (country === 'CM' ? 'XAF' : 'XOF')} via Moteur →`
                      )}
                    </Button>
                    <p className="text-[11px] text-[#9CA3AF] text-center mt-2">
                      Infrastructure centralisée Moteur &bull; Activation sur confirmation réelle
                    </p>
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="p-12 flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-4 border-[#6D28D9] border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium text-[#6B7280]">Chargement de la facturation...</p>
        </div>
      }
    >
      <BillingPageContent />
    </Suspense>
  );
}

