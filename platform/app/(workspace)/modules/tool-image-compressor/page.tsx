'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';

export default function ImageCompressorPage() {
  const { t, language } = useTranslation();

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalUrl, setOriginalUrl] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<number>(0);

  const [compressedUrl, setCompressedUrl] = useState<string | null>(null);
  const [compressedSize, setCompressedSize] = useState<number>(0);

  const [quality, setQuality] = useState<number>(75);
  const [maxDimension, setMaxDimension] = useState<number>(1280);
  const [format, setFormat] = useState<'image/jpeg' | 'image/webp'>('image/jpeg');

  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Format file size helper
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const compressImage = (file: File, q: number, maxDim: number, fmt: string) => {
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate proportional dimensions
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setIsProcessing(false);
          return;
        }

        // Fill white background in case of transparent PNGs converted to JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              if (compressedUrl) URL.revokeObjectURL(compressedUrl);
              const url = URL.createObjectURL(blob);
              setCompressedUrl(url);
              setCompressedSize(blob.size);
            }
            setIsProcessing(false);
          },
          fmt,
          q / 100
        );
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (originalUrl) URL.revokeObjectURL(originalUrl);
    setOriginalFile(file);
    setOriginalSize(file.size);
    setOriginalUrl(URL.createObjectURL(file));

    compressImage(file, quality, maxDimension, format);
  };

  const handleQualityChange = (newQuality: number) => {
    setQuality(newQuality);
    if (originalFile) {
      compressImage(originalFile, newQuality, maxDimension, format);
    }
  };

  const handleDimensionChange = (newDim: number) => {
    setMaxDimension(newDim);
    if (originalFile) {
      compressImage(originalFile, quality, newDim, format);
    }
  };

  const handleFormatChange = (newFmt: 'image/jpeg' | 'image/webp') => {
    setFormat(newFmt);
    if (originalFile) {
      compressImage(originalFile, quality, maxDimension, newFmt);
    }
  };

  const savingsPercent =
    originalSize > 0 && compressedSize > 0
      ? Math.max(0, Math.round(((originalSize - compressedSize) / originalSize) * 100))
      : 0;

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
            <div className="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center text-2xl border border-blue-100">
              🖼️
            </div>
            <div>
              <h1 className="text-2xl font-black text-[#1F2937]">
                {language === 'fr' ? 'Compresseur & Redimensionneur d’Images' : 'Image Compressor & Resizer'}
              </h1>
              <p className="text-xs text-[#6B7280]">
                {language === 'fr'
                  ? 'Allégez le poids de vos photos jusqu’à 85% directement dans le navigateur sans perte visible'
                  : 'Compress photos by up to 85% directly in your browser with zero quality compromise'}
              </p>
            </div>
          </div>
        </div>

        {compressedUrl && (
          <a
            href={compressedUrl}
            download={`compressed_${originalFile?.name || 'image'}.${format === 'image/webp' ? 'webp' : 'jpg'}`}
          >
            <Button variant="primary" size="sm">
              ⬇ {language === 'fr' ? 'Télécharger l’image compressée' : 'Download Compressed'}
            </Button>
          </a>
        )}
      </div>

      {!originalFile ? (
        /* Dropzone Card */
        <Card padding="lg" className="border-dashed border-2 border-blue-200 text-center py-16 bg-blue-50/20">
          <div className="max-w-md mx-auto space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-blue-100 text-blue-600 flex items-center justify-center text-3xl mx-auto">
              📁
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-800">
                {language === 'fr' ? 'Sélectionnez une image à compresser' : 'Select an image to compress'}
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                {language === 'fr'
                  ? 'Prend en charge JPG, PNG, WebP (jusqu’à 20 Mo). 100% privé : aucune photo n’est envoyée à l’extérieur.'
                  : 'Supports JPG, PNG, WebP (up to 20 MB). 100% private: files never leave your browser.'}
              </p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              variant="primary"
              size="md"
              onClick={() => fileInputRef.current?.click()}
            >
              + {language === 'fr' ? 'Choisir une photo / image' : 'Choose Photo / Image'}
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Controls Column */}
          <div className="md:col-span-5 space-y-6">
            <Card padding="lg" className="border-[#E5E7EB] space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-800">
                  {language === 'fr' ? 'Réglages d’optimisation' : 'Compression Settings'}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setOriginalFile(null);
                    setOriginalUrl(null);
                    setCompressedUrl(null);
                  }}
                  className="text-xs text-red-600 hover:underline font-bold"
                >
                  {language === 'fr' ? 'Changer d’image' : 'Change Image'}
                </button>
              </div>

              {/* Quality Slider */}
              <div>
                <div className="flex justify-between text-xs font-bold text-zinc-700 mb-1.5">
                  <span>{language === 'fr' ? 'Qualité de compression' : 'Compression Quality'}</span>
                  <span className="text-blue-600">{quality}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="95"
                  step="5"
                  value={quality}
                  onChange={(e) => handleQualityChange(Number(e.target.value))}
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-zinc-400 mt-1">
                  <span>{language === 'fr' ? 'Plus léger (20%)' : 'Smallest (20%)'}</span>
                  <span>{language === 'fr' ? 'Recommandé (75%)' : 'Balanced (75%)'}</span>
                  <span>{language === 'fr' ? 'Haute qualité (95%)' : 'Highest (95%)'}</span>
                </div>
              </div>

              {/* Max Dimension */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  {language === 'fr' ? 'Dimension maximale (Largeur / Hauteur)' : 'Max Dimension (Width / Height)'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[800, 1280, 1920].map((dim) => (
                    <button
                      key={dim}
                      type="button"
                      onClick={() => handleDimensionChange(dim)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                        maxDimension === dim
                          ? 'bg-blue-50 text-blue-700 border-blue-300'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {dim}px
                    </button>
                  ))}
                </div>
              </div>

              {/* Format selection */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1.5">
                  {language === 'fr' ? 'Format de sortie' : 'Output Format'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id: 'image/jpeg', label: 'JPEG (Universel)' },
                    { id: 'image/webp', label: 'WebP (Ultra-léger)' },
                  ].map((fmt) => (
                    <button
                      key={fmt.id}
                      type="button"
                      onClick={() => handleFormatChange(fmt.id as any)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                        format === fmt.id
                          ? 'bg-blue-50 text-blue-700 border-blue-300'
                          : 'bg-white text-zinc-600 border-zinc-200 hover:bg-zinc-50'
                      }`}
                    >
                      {fmt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Metrics Summary */}
              <div className="p-4 bg-zinc-50 rounded-2xl border border-zinc-200 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">{language === 'fr' ? 'Poids initial :' : 'Original Size:'}</span>
                  <span className="font-mono font-bold text-zinc-700">{formatBytes(originalSize)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-500">{language === 'fr' ? 'Poids compressé :' : 'Compressed Size:'}</span>
                  <span className="font-mono font-bold text-emerald-700">{formatBytes(compressedSize)}</span>
                </div>
                <div className="flex justify-between text-xs pt-2 border-t border-zinc-200 font-bold">
                  <span className="text-zinc-800">{language === 'fr' ? 'Gain d’espace :' : 'Space Saved:'}</span>
                  <span className="text-emerald-600">-{savingsPercent}% ({formatBytes(originalSize - compressedSize)})</span>
                </div>
              </div>

              {compressedUrl && (
                <a
                  href={compressedUrl}
                  download={`compressed_${originalFile?.name || 'image'}.${format === 'image/webp' ? 'webp' : 'jpg'}`}
                  className="block w-full"
                >
                  <Button variant="primary" size="md" className="w-full justify-center font-bold">
                    ⬇ {language === 'fr' ? 'Télécharger le fichier optimisé' : 'Download Optimized Image'}
                  </Button>
                </a>
              )}
            </Card>
          </div>

          {/* Preview Column */}
          <div className="md:col-span-7 space-y-6">
            <Card padding="lg" className="border-[#E5E7EB] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-800">
                  {language === 'fr' ? 'Résultat de la compression' : 'Compression Result'}
                </h3>
                {savingsPercent > 0 && (
                  <Badge variant="green" size="sm">
                    -{savingsPercent}% {language === 'fr' ? 'plus léger' : 'smaller'}
                  </Badge>
                )}
              </div>

              <div className="relative rounded-2xl overflow-hidden bg-zinc-100 border border-zinc-200 min-h-[300px] flex items-center justify-center">
                {isProcessing ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-zinc-500 font-medium">
                      {language === 'fr' ? 'Compression en cours...' : 'Optimizing...'}
                    </span>
                  </div>
                ) : compressedUrl ? (
                  <img
                    src={compressedUrl}
                    alt="Compressed Preview"
                    className="max-h-[440px] w-auto object-contain mx-auto"
                  />
                ) : null}
              </div>

              <p className="text-[11px] text-zinc-500 text-center">
                💡 {language === 'fr'
                  ? 'Idéal pour accélérer le chargement de votre catalogue en ligne et réduire les frais de données mobiles.'
                  : 'Perfect for speeding up mobile catalog browsing and cutting mobile data consumption.'}
              </p>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
