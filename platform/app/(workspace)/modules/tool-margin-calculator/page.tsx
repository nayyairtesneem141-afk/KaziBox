'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';

export default function MarginCalculatorPage() {
  const { t, language } = useTranslation();

  const [activeTab, setActiveTab] = useState<'margin' | 'vat' | 'discount' | 'growth'>('margin');

  // Mode 1: Margin & Markup
  const [costPrice, setCostPrice] = useState<number>(5000);
  const [sellingPrice, setSellingPrice] = useState<number>(8500);

  // Mode 2: VAT / TVA
  const [vatAmount, setVatAmount] = useState<number>(10000);
  const [vatRate, setVatRate] = useState<number>(18); // Default 18% UEMOA
  const [vatDirection, setVatDirection] = useState<'ht_to_ttc' | 'ttc_to_ht'>('ht_to_ttc');

  // Mode 3: Discount
  const [discountOriginal, setDiscountOriginal] = useState<number>(15000);
  const [discountPercent, setDiscountPercent] = useState<number>(20);

  // Mode 4: Growth
  const [growthOld, setGrowthOld] = useState<number>(120000);
  const [growthNew, setGrowthNew] = useState<number>(156000);

  // Computed calculations
  // 1. Margin
  const grossProfit = sellingPrice - costPrice;
  const marginPercent = costPrice > 0 ? (grossProfit / costPrice) * 100 : 0; // Taux de marge
  const markupPercent = sellingPrice > 0 ? (grossProfit / sellingPrice) * 100 : 0; // Taux de marque
  const multiplier = costPrice > 0 ? sellingPrice / costPrice : 0;

  // 2. VAT
  let htVal = 0;
  let taxVal = 0;
  let ttcVal = 0;
  if (vatDirection === 'ht_to_ttc') {
    htVal = vatAmount;
    taxVal = htVal * (vatRate / 100);
    ttcVal = htVal + taxVal;
  } else {
    ttcVal = vatAmount;
    htVal = ttcVal / (1 + vatRate / 100);
    taxVal = ttcVal - htVal;
  }

  // 3. Discount
  const discountSavings = discountOriginal * (discountPercent / 100);
  const finalDiscounted = discountOriginal - discountSavings;

  // 4. Growth
  const growthDiff = growthNew - growthOld;
  const growthPercent = growthOld > 0 ? (growthDiff / growthOld) * 100 : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Top Breadcrumb & Badge */}
      <div className="flex items-center justify-between">
        <Link
          href="/modules/catalogue"
          className="inline-flex items-center gap-2 text-sm font-bold text-[#6D28D9] hover:underline"
        >
          &larr; {t('catalogue.back_to_catalogue')}
        </Link>
        <Badge variant="green" size="md">
          ✓ {language === 'fr' ? 'Outil Gratuit Illimité' : 'Unlimited Free Utility'}
        </Badge>
      </div>

      {/* Header Banner */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-[#E5E7EB] shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center text-2xl border border-amber-100">
              🧮
            </div>
            <div>
              <h1 className="text-2xl font-black text-[#1F2937]">
                {language === 'fr' ? 'Calculateur de Marge & Pourcentage' : 'Margin & Percentage Calculator'}
              </h1>
              <p className="text-xs text-[#6B7280]">
                {language === 'fr'
                  ? 'Calculs financiers instantanés : marges commerciales, TVA UEMOA, remises et évolutions de CA'
                  : 'Instant commercial math: profit margins, VAT calculations, promo discounts, and growth'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { id: 'margin', label: 'Marge & Marque', labelEn: 'Margin & Markup', icon: '📈' },
          { id: 'vat', label: 'TVA (UEMOA 18%)', labelEn: 'VAT / Tax', icon: '🧾' },
          { id: 'discount', label: 'Remise & Solde', labelEn: 'Discount / Sale', icon: '🏷️' },
          { id: 'growth', label: 'Évolution & Croissance', labelEn: 'Growth / Change', icon: '📊' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id as any)}
            className={`py-3 px-4 rounded-2xl text-xs font-bold transition-all border flex items-center justify-center gap-2 ${
              activeTab === tab.id
                ? 'bg-amber-50 text-amber-900 border-amber-300 shadow-sm'
                : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{language === 'fr' ? tab.label : tab.labelEn}</span>
          </button>
        ))}
      </div>

      {/* TAB 1: MARGIN & MARKUP */}
      {activeTab === 'margin' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-4">
              <h3 className="text-sm font-bold text-zinc-800">
                {language === 'fr' ? 'Paramètres d’Achat et de Vente' : 'Cost & Selling Price'}
              </h3>
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Prix d’Achat (Coût de revient)' : 'Cost Price'} (XOF)
                </label>
                <input
                  type="number"
                  value={costPrice}
                  onChange={(e) => setCostPrice(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono font-bold"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Prix de Vente proposé' : 'Selling Price'} (XOF)
                </label>
                <input
                  type="number"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono font-bold"
                />
              </div>
            </Card>
          </div>

          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-3">
              <h3 className="text-sm font-bold text-zinc-800 mb-2">
                {language === 'fr' ? 'Rentabilité Commerciale Calculée' : 'Profitability Results'}
              </h3>

              <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200">
                <span className="text-[11px] font-bold text-amber-800 uppercase block">
                  {language === 'fr' ? 'Bénéfice Brut par unité' : 'Gross Profit per Unit'}
                </span>
                <span className="text-2xl font-black text-amber-900 font-mono">
                  {grossProfit.toLocaleString()} XOF
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase block">
                    {language === 'fr' ? 'Taux de Marge' : 'Margin Rate'} (Marge/Achat)
                  </span>
                  <span className="text-lg font-black text-zinc-800 font-mono">
                    {marginPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase block">
                    {language === 'fr' ? 'Taux de Marque' : 'Markup Rate'} (Marge/Vente)
                  </span>
                  <span className="text-lg font-black text-zinc-800 font-mono">
                    {markupPercent.toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 flex justify-between items-center">
                <span className="text-xs text-zinc-600 font-medium">
                  {language === 'fr' ? 'Coefficient Multiplicateur :' : 'Price Multiplier:'}
                </span>
                <span className="text-sm font-black text-zinc-800 font-mono">
                  x {multiplier.toFixed(2)}
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: VAT / TVA */}
      {activeTab === 'vat' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-4">
              <h3 className="text-sm font-bold text-zinc-800">
                {language === 'fr' ? 'Paramètres de TVA' : 'VAT Parameters'}
              </h3>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Sens de conversion' : 'Calculation Direction'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setVatDirection('ht_to_ttc')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                      vatDirection === 'ht_to_ttc'
                        ? 'bg-amber-50 text-amber-900 border-amber-300'
                        : 'bg-white text-zinc-600 border-zinc-200'
                    }`}
                  >
                    HT &rarr; TTC
                  </button>
                  <button
                    type="button"
                    onClick={() => setVatDirection('ttc_to_ht')}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                      vatDirection === 'ttc_to_ht'
                        ? 'bg-amber-50 text-amber-900 border-amber-300'
                        : 'bg-white text-zinc-600 border-zinc-200'
                    }`}
                  >
                    TTC &rarr; HT
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {vatDirection === 'ht_to_ttc' 
                    ? (language === 'fr' ? 'Montant Hors Taxe (HT)' : 'Net Amount (excl. tax)')
                    : (language === 'fr' ? 'Montant Toutes Taxes Comprises (TTC)' : 'Gross Amount (incl. tax)')} (XOF)
                </label>
                <input
                  type="number"
                  value={vatAmount}
                  onChange={(e) => setVatAmount(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Taux de TVA (%)' : 'VAT Rate (%)'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[18, 20, 10].map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      onClick={() => setVatRate(rate)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border ${
                        vatRate === rate
                          ? 'bg-amber-50 text-amber-900 border-amber-300'
                          : 'bg-white text-zinc-600 border-zinc-200'
                      }`}
                    >
                      {rate}% {rate === 18 ? '(UEMOA)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-3">
              <h3 className="text-sm font-bold text-zinc-800 mb-2">
                {language === 'fr' ? 'Ventilation Fiscale Calculée' : 'Tax Breakdown'}
              </h3>

              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 flex justify-between items-center">
                <span className="text-xs text-zinc-600 font-medium">
                  {language === 'fr' ? 'Montant Net (HT) :' : 'Net Amount (HT):'}
                </span>
                <span className="text-sm font-black text-zinc-800 font-mono">
                  {Math.round(htVal).toLocaleString()} XOF
                </span>
              </div>

              <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 flex justify-between items-center">
                <div>
                  <span className="text-[11px] font-bold text-amber-800 uppercase block">
                    {language === 'fr' ? 'Part de TVA' : 'VAT Tax'} ({vatRate}%)
                  </span>
                  <span className="text-lg font-black text-amber-900 font-mono">
                    {Math.round(taxVal).toLocaleString()} XOF
                  </span>
                </div>
              </div>

              <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200 flex justify-between items-center">
                <div>
                  <span className="text-[11px] font-bold text-emerald-800 uppercase block">
                    {language === 'fr' ? 'Total à Facturer (TTC)' : 'Total Payable (TTC)'}
                  </span>
                  <span className="text-xl font-black text-emerald-900 font-mono">
                    {Math.round(ttcVal).toLocaleString()} XOF
                  </span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 3: DISCOUNT */}
      {activeTab === 'discount' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-4">
              <h3 className="text-sm font-bold text-zinc-800">
                {language === 'fr' ? 'Prix d’Origine et Remise' : 'Price & Discount Percentage'}
              </h3>
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Prix initial avant remise' : 'Original Price'} (XOF)
                </label>
                <input
                  type="number"
                  value={discountOriginal}
                  onChange={(e) => setDiscountOriginal(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Pourcentage de remise (%)' : 'Discount Percentage (%)'} : {discountPercent}%
                </label>
                <input
                  type="range"
                  min="5"
                  max="70"
                  step="5"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  className="w-full accent-amber-600 cursor-pointer"
                />
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {[10, 20, 30, 50].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setDiscountPercent(pct)}
                      className={`py-1.5 rounded-lg text-xs font-bold border ${
                        discountPercent === pct
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-white text-zinc-600 border-zinc-200'
                      }`}
                    >
                      -{pct}%
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          </div>

          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-3">
              <h3 className="text-sm font-bold text-zinc-800 mb-2">
                {language === 'fr' ? 'Prix Promotionnel Obtenu' : 'Discount Result'}
              </h3>

              <div className="p-3.5 bg-emerald-50 rounded-2xl border border-emerald-200">
                <span className="text-[11px] font-bold text-emerald-800 uppercase block">
                  {language === 'fr' ? 'Nouveau Prix Soldé' : 'Final Discounted Price'}
                </span>
                <span className="text-2xl font-black text-emerald-900 font-mono">
                  {Math.round(finalDiscounted).toLocaleString()} XOF
                </span>
              </div>

              <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200">
                <span className="text-[11px] font-bold text-amber-800 uppercase block">
                  {language === 'fr' ? 'Économie Client Accordée' : 'Customer Savings'}
                </span>
                <span className="text-lg font-black text-amber-900 font-mono">
                  - {Math.round(discountSavings).toLocaleString()} XOF
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 4: GROWTH */}
      {activeTab === 'growth' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-4">
              <h3 className="text-sm font-bold text-zinc-800">
                {language === 'fr' ? 'Période 1 vs Période 2' : 'Period Comparison'}
              </h3>
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Valeur de départ (ex: CA Mois 1)' : 'Start Value (e.g. Month 1 Revenue)'}
                </label>
                <input
                  type="number"
                  value={growthOld}
                  onChange={(e) => setGrowthOld(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  {language === 'fr' ? 'Valeur finale (ex: CA Mois 2)' : 'Final Value (e.g. Month 2 Revenue)'}
                </label>
                <input
                  type="number"
                  value={growthNew}
                  onChange={(e) => setGrowthNew(Number(e.target.value))}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm font-mono font-bold"
                />
              </div>
            </Card>
          </div>

          <div className="md:col-span-6 space-y-4">
            <Card padding="lg" className="border-[#E5E7EB] space-y-3">
              <h3 className="text-sm font-bold text-zinc-800 mb-2">
                {language === 'fr' ? 'Taux de Croissance / Évolution' : 'Growth Indicator'}
              </h3>

              <div className={`p-3.5 rounded-2xl border ${
                growthDiff >= 0 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}>
                <span className="text-[11px] font-bold uppercase block opacity-80">
                  {growthDiff >= 0 
                    ? (language === 'fr' ? 'Hausse / Croissance' : 'Growth') 
                    : (language === 'fr' ? 'Baisse / Régression' : 'Decline')}
                </span>
                <span className="text-3xl font-black font-mono">
                  {growthDiff >= 0 ? '+' : ''}{growthPercent.toFixed(1)}%
                </span>
              </div>

              <div className="p-3 bg-zinc-50 rounded-xl border border-zinc-200 flex justify-between items-center">
                <span className="text-xs text-zinc-600 font-medium">
                  {language === 'fr' ? 'Différence brute :' : 'Raw Difference:'}
                </span>
                <span className="text-sm font-black text-zinc-800 font-mono">
                  {growthDiff >= 0 ? '+' : ''}{growthDiff.toLocaleString()}
                </span>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
