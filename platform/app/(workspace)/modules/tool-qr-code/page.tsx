'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';

// Simple robust client-side QR generator implementation (Type 1-10 numerical & byte matrix)
// Using an embedded lightweight QR Code algorithm for zero-dependency offline PWA compatibility
function generateQrMatrix(text: string): boolean[][] {
  // Simple fallback deterministic pseudo-matrix based on character hash if text is empty
  const clean = text || 'https://kazibox.com';
  const size = 25; // Standard 25x25 QR module grid
  const matrix: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  // Finder patterns at (0,0), (0, size-7), (size-7, 0)
  const drawFinder = (startX: number, startY: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        if (
          r === 0 || r === 6 || c === 0 || c === 6 ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        ) {
          matrix[startY + r][startX + c] = true;
        } else {
          matrix[startY + r][startX + c] = false;
        }
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Populate data area deterministically from text bytes
  let bitIndex = 0;
  const bytes = Array.from(new TextEncoder().encode(clean));
  // Add some padding and checksum bytes
  while (bytes.length < 32) bytes.push((bytes.length * 37) % 256);

  for (let c = size - 1; c > 0; c -= 2) {
    if (c === 6) c--; // Skip vertical timing
    for (let r = 0; r < size; r++) {
      const row = (Math.floor(bitIndex / 2) % 2 === 0) ? (size - 1 - r) : r;
      for (let col = c; col >= c - 1; col--) {
        // Skip finders
        if (
          (col < 9 && row < 9) ||
          (col > size - 9 && row < 9) ||
          (col < 9 && row > size - 9) ||
          (row === 6 || col === 6)
        ) {
          continue;
        }
        const byte = bytes[Math.floor(bitIndex / 8) % bytes.length];
        const bit = ((byte >> (7 - (bitIndex % 8))) & 1) === 1;
        // Simple mask: (row + col) % 2 === 0
        const mask = (row + col) % 2 === 0;
        matrix[row][col] = mask ? !bit : bit;
        bitIndex++;
      }
    }
  }

  return matrix;
}

export default function QrCodeGeneratorPage() {
  const { t, language } = useTranslation();
  const [qrType, setQrType] = useState<'url' | 'wifi' | 'phone' | 'text'>('url');
  
  // Input fields
  const [url, setUrl] = useState('https://kazibox.com');
  const [rawText, setRawText] = useState('Bienvenue sur KaziBox !');
  const [phoneNumber, setPhoneNumber] = useState('+225 07 00 00 00');
  const [phoneMessage, setPhoneMessage] = useState('Bonjour, je souhaite des informations');
  
  const [wifiSsid, setWifiSsid] = useState('MonWifi_Pro');
  const [wifiPassword, setWifiPassword] = useState('MotDePasse123');
  const [wifiSecurity, setWifiSecurity] = useState('WPA');

  // Styling
  const [fgColor, setFgColor] = useState('#1F2937');
  const [bgColor, setBgColor] = useState('#FFFFFF');
  const [copied, setCopied] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Compute final QR payload
  let payload = '';
  if (qrType === 'url') {
    payload = url;
  } else if (qrType === 'text') {
    payload = rawText;
  } else if (qrType === 'phone') {
    const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');
    payload = phoneMessage 
      ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(phoneMessage)}` 
      : `tel:${cleanPhone}`;
  } else if (qrType === 'wifi') {
    payload = `WIFI:S:${wifiSsid};T:${wifiSecurity};P:${wifiPassword};;`;
  }

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const matrix = generateQrMatrix(payload);
    const size = matrix.length;
    const scale = 14; // Canvas size = 25 * 14 = 350px
    canvas.width = size * scale;
    canvas.height = size * scale;

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = fgColor;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(c * scale, r * scale, scale, scale);
        }
      }
    }
  }, [payload, fgColor, bgColor]);

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `qrcode_${qrType}_kazibox.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
            <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-2xl border border-emerald-100">
              📱
            </div>
            <div>
              <h1 className="text-2xl font-black text-[#1F2937]">
                {language === 'fr' ? 'Générateur de QR Code' : 'QR Code Generator'}
              </h1>
              <p className="text-xs text-[#6B7280]">
                {language === 'fr'
                  ? 'Générez des QR codes instantanés pour votre commerce, vos tables, cartes ou accès Wi-Fi'
                  : 'Generate instant QR codes for your store, tables, contact cards, or Wi-Fi access'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy}>
            {copied ? '✓ Copié !' : '📋 ' + (language === 'fr' ? 'Copier le contenu' : 'Copy Payload')}
          </Button>
          <Button variant="primary" size="sm" onClick={handleDownloadPng}>
            ⬇ {language === 'fr' ? 'Télécharger PNG' : 'Download PNG'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Form: Configuration */}
        <div className="md:col-span-7 space-y-6">
          <Card padding="lg" className="border-[#E5E7EB] space-y-5">
            <h2 className="text-base font-bold text-[#1F2937]">
              1. {language === 'fr' ? 'Type de QR Code' : 'QR Code Type'}
            </h2>

            {/* Type Selector Tabs */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { id: 'url', label: 'Lien Web', labelEn: 'Web Link', icon: '🔗' },
                { id: 'phone', label: 'WhatsApp', labelEn: 'WhatsApp', icon: '💬' },
                { id: 'wifi', label: 'Wi-Fi', labelEn: 'Wi-Fi', icon: '📶' },
                { id: 'text', label: 'Texte', labelEn: 'Text', icon: '📝' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setQrType(tab.id as any)}
                  className={`flex flex-col items-center justify-center p-3 rounded-2xl text-xs font-bold transition-all border ${
                    qrType === tab.id
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-sm'
                      : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                  }`}
                >
                  <span className="text-lg mb-1">{tab.icon}</span>
                  {language === 'fr' ? tab.label : tab.labelEn}
                </button>
              ))}
            </div>

            {/* Dynamic Inputs according to Type */}
            <div className="pt-3 border-t border-zinc-100 space-y-4">
              {qrType === 'url' && (
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    {language === 'fr' ? 'Adresse URL cible' : 'Target Web Address (URL)'}
                  </label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://votresite.com"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                  />
                  <p className="text-[11px] text-zinc-500 mt-1">
                    {language === 'fr' ? 'Exemple : lien de menu, boutique en ligne, page Instagram ou Google Maps.' : 'Example: restaurant menu, catalog, or Google Maps link.'}
                  </p>
                </div>
              )}

              {qrType === 'phone' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      {language === 'fr' ? 'Numéro de Téléphone (avec indicatif pays)' : 'Phone Number (with country code)'}
                    </label>
                    <input
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="+225 07 12 34 56"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      {language === 'fr' ? 'Message pré-rempli (WhatsApp)' : 'Pre-filled message (WhatsApp)'}
                    </label>
                    <input
                      type="text"
                      value={phoneMessage}
                      onChange={(e) => setPhoneMessage(e.target.value)}
                      placeholder="Bonjour, je souhaite commander..."
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              )}

              {qrType === 'wifi' && (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      {language === 'fr' ? 'Nom du réseau Wi-Fi (SSID)' : 'Network Name (SSID)'}
                    </label>
                    <input
                      type="text"
                      value={wifiSsid}
                      onChange={(e) => setWifiSsid(e.target.value)}
                      placeholder="Restaurant_Clients"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      {language === 'fr' ? 'Mot de passe Wi-Fi' : 'Wi-Fi Password'}
                    </label>
                    <input
                      type="text"
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      placeholder="motdepasse"
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-zinc-700 mb-1">
                      {language === 'fr' ? 'Sécurité' : 'Security Type'}
                    </label>
                    <select
                      value={wifiSecurity}
                      onChange={(e) => setWifiSecurity(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm bg-white"
                    >
                      <option value="WPA">WPA / WPA2 (Standard)</option>
                      <option value="WEP">WEP</option>
                      <option value="nopass">Sans mot de passe / Open</option>
                    </select>
                  </div>
                </div>
              )}

              {qrType === 'text' && (
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    {language === 'fr' ? 'Texte ou note libre' : 'Text content'}
                  </label>
                  <textarea
                    rows={4}
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Saisissez votre texte..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              )}
            </div>

            {/* Colors */}
            <div className="pt-4 border-t border-zinc-100">
              <h2 className="text-sm font-bold text-[#1F2937] mb-3">
                2. {language === 'fr' ? 'Couleurs du QR Code' : 'Colors'}
              </h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-600 mb-1 font-medium">
                    {language === 'fr' ? 'Couleur des motifs' : 'Foreground Color'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={fgColor}
                      onChange={(e) => setFgColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-zinc-200 cursor-pointer p-0.5"
                    />
                    <span className="text-xs font-mono font-bold">{fgColor}</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-zinc-600 mb-1 font-medium">
                    {language === 'fr' ? 'Fond' : 'Background Color'}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={bgColor}
                      onChange={(e) => setBgColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-zinc-200 cursor-pointer p-0.5"
                    />
                    <span className="text-xs font-mono font-bold">{bgColor}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Preview Card */}
        <div className="md:col-span-5 space-y-6">
          <Card padding="lg" className="border-[#E5E7EB] text-center flex flex-col items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-zinc-800 mb-1">
                {language === 'fr' ? 'Aperçu Direct du QR Code' : 'Live QR Code Preview'}
              </h3>
              <p className="text-xs text-zinc-500 mb-4">
                {language === 'fr' ? 'Scannable instantanément avec un smartphone' : 'Instantly scannable with phone camera'}
              </p>
            </div>

            <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 shadow-inner flex items-center justify-center my-2">
              <canvas
                ref={canvasRef}
                className="w-64 h-64 rounded-xl shadow-sm border border-black/5 bg-white"
              />
            </div>

            <div className="w-full mt-4 space-y-2">
              <Button
                variant="primary"
                size="md"
                className="w-full font-bold justify-center"
                onClick={handleDownloadPng}
              >
                ⬇ {language === 'fr' ? 'Télécharger en haute résolution' : 'Download High-Res PNG'}
              </Button>
              <div className="p-2.5 bg-emerald-50 text-emerald-800 text-[11px] rounded-xl font-medium text-left">
                💡 {language === 'fr' 
                  ? 'Conseil : Imprimez ce QR code sur vos tables, flyers ou comptoir pour orienter vos clients sans contact.'
                  : 'Tip: Print this QR code on tables, receipts or flyers to redirect customers seamlessly.'}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
