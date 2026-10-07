'use client';

import React, { useState, useRef } from 'react';
import Link from 'next/link';
import { Card, Button, Badge } from '@kazibox/ui';
import { useTranslation } from '@/lib/i18n';

interface ImageItem {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
}

export default function JpgToPdfConverterPage() {
  const { t, language } = useTranslation();

  const [images, setImages] = useState<ImageItem[]>([]);
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [pageSize, setPageSize] = useState<'A4' | 'Letter'>('A4');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newItems: ImageItem[] = Array.from(files).map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      file: f,
      previewUrl: URL.createObjectURL(f),
      name: f.name,
      size: f.size,
    }));

    setImages((prev) => [...prev, ...newItems]);
    if (generatedPdfUrl) {
      URL.revokeObjectURL(generatedPdfUrl);
      setGeneratedPdfUrl(null);
    }
  };

  const removeImage = (id: string) => {
    setImages((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    setImages((prev) => {
      const copy = [...prev];
      const temp = copy[index - 1];
      copy[index - 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  const moveDown = (index: number) => {
    if (index === images.length - 1) return;
    setImages((prev) => {
      const copy = [...prev];
      const temp = copy[index + 1];
      copy[index + 1] = copy[index];
      copy[index] = temp;
      return copy;
    });
  };

  // Pure Client-side PDF Generation without heavy dependencies
  const generatePdf = async () => {
    if (images.length === 0) return;
    setIsGenerating(true);

    try {
      // Dimensions in points (72 points per inch)
      // A4: 595 x 842 points
      const pw = orientation === 'portrait' ? 595 : 842;
      const ph = orientation === 'portrait' ? 842 : 595;

      // We construct a valid PDF 1.4 document
      const objects: string[] = [];
      const offsets: number[] = [];
      let pdfContent = '%PDF-1.4\n';

      const addObject = (content: string) => {
        offsets.push(pdfContent.length);
        const objNumber = objects.length + 1;
        const entry = `${objNumber} 0 obj\n${content}\nendobj\n`;
        pdfContent += entry;
        objects.push(entry);
        return objNumber;
      };

      // Read images as JPEGs via canvas
      const processedImages: Array<{ dataUri: string; width: number; height: number; rawBytes: Uint8Array }> = [];
      for (const item of images) {
        const img = new Image();
        await new Promise((res) => {
          img.onload = res;
          img.src = item.previewUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, img.width, img.height);
        ctx.drawImage(img, 0, 0);

        const jpegBlob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.85));
        const arrayBuf = await jpegBlob.arrayBuffer();
        processedImages.push({
          dataUri: canvas.toDataURL('image/jpeg', 0.85),
          width: img.width,
          height: img.height,
          rawBytes: new Uint8Array(arrayBuf),
        });
      }

      // Root Catalog (obj 1) & Pages Tree (obj 2)
      // We'll link pages together
      const totalPages = processedImages.length;
      const pageObjNumbers: number[] = [];

      // For each image, we create:
      // - Image XObject
      // - Page content stream (cm and Do operators)
      // - Page object
      let currentObjIndex = 3; // reserve 1 (Catalog) and 2 (Pages)

      for (let i = 0; i < totalPages; i++) {
        const imgInfo = processedImages[i];
        const imgObjNum = currentObjIndex++;
        const contentStreamObjNum = currentObjIndex++;
        const pageObjNum = currentObjIndex++;
        pageObjNumbers.push(pageObjNum);

        // Convert raw bytes to binary string
        let binString = '';
        for (let b = 0; b < imgInfo.rawBytes.length; b++) {
          binString += String.fromCharCode(imgInfo.rawBytes[b]);
        }

        // 1. Image XObject
        addObject(
          `<< /Type /XObject /Subtype /Image /Width ${imgInfo.width} /Height ${imgInfo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgInfo.rawBytes.length} >>\nstream\n${binString}\nendstream`
        );

        // Scale image to fit page maintaining aspect ratio with 20pt margin
        const margin = 20;
        const availW = pw - margin * 2;
        const availH = ph - margin * 2;
        let drawW = availW;
        let drawH = (imgInfo.height * availW) / imgInfo.width;
        if (drawH > availH) {
          drawH = availH;
          drawW = (imgInfo.width * availH) / imgInfo.height;
        }
        const drawX = (pw - drawW) / 2;
        const drawY = (ph - drawH) / 2;

        const streamCmds = `q\n${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${drawX.toFixed(2)} ${drawY.toFixed(2)} cm\n/Im${i + 1} Do\nQ\n`;

        // 2. Content stream
        addObject(
          `<< /Length ${streamCmds.length} >>\nstream\n${streamCmds}endstream`
        );

        // 3. Page object
        addObject(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im${i + 1} ${imgObjNum} 0 R >> >> /Contents ${contentStreamObjNum} 0 R >>`
        );
      }

      // Catalog (obj 1)
      const catalogObj = `<< /Type /Catalog /Pages 2 0 R >>`;
      // Pages Tree (obj 2)
      const pagesObj = `<< /Type /Pages /Kids [${pageObjNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${totalPages} >>`;

      // Prepend Catalog & Pages at the correct offsets
      const fullObjects: string[] = [catalogObj, pagesObj, ...objects];
      let completePdf = '%PDF-1.4\n';
      const fullOffsets: number[] = [];

      for (let i = 0; i < fullObjects.length; i++) {
        fullOffsets.push(completePdf.length);
        completePdf += `${i + 1} 0 obj\n${fullObjects[i]}\nendobj\n`;
      }

      const xrefOffset = completePdf.length;
      completePdf += `xref\n0 ${fullObjects.length + 1}\n0000000000 65535 f \n`;
      for (const off of fullOffsets) {
        completePdf += `${off.toString().padStart(10, '0')} 00000 n \n`;
      }
      completePdf += `trailer\n<< /Size ${fullObjects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

      // Convert completePdf string to Uint8Array
      const finalBytes = new Uint8Array(completePdf.length);
      for (let i = 0; i < completePdf.length; i++) {
        finalBytes[i] = completePdf.charCodeAt(i) & 0xff;
      }

      const blob = new Blob([finalBytes], { type: 'application/pdf' });
      if (generatedPdfUrl) URL.revokeObjectURL(generatedPdfUrl);
      const url = URL.createObjectURL(blob);
      setGeneratedPdfUrl(url);
    } catch (err) {
      console.error('PDF Generation failed:', err);
    } finally {
      setIsGenerating(false);
    }
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
            <div className="w-12 h-12 rounded-2xl bg-pink-50 text-pink-600 flex items-center justify-center text-2xl border border-pink-100">
              📄
            </div>
            <div>
              <h1 className="text-2xl font-black text-[#1F2937]">
                {language === 'fr' ? 'Convertisseur JPG en PDF' : 'JPG to PDF Converter'}
              </h1>
              <p className="text-xs text-[#6B7280]">
                {language === 'fr'
                  ? 'Assemblez vos reçus, photos de documents ou factures dans un document PDF propre'
                  : 'Combine receipts, photos, and scanned documents into a clean PDF ready to share'}
              </p>
            </div>
          </div>
        </div>

        {images.length > 0 && (
          <Button
            variant="primary"
            size="sm"
            onClick={generatePdf}
            disabled={isGenerating}
          >
            {isGenerating
              ? (language === 'fr' ? 'Génération...' : 'Generating...')
              : '⚡ ' + (language === 'fr' ? 'Générer le PDF' : 'Build PDF Document')}
          </Button>
        )}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Settings & Upload Area */}
        <div className="md:col-span-5 space-y-6">
          <Card padding="lg" className="border-[#E5E7EB] space-y-5">
            <h3 className="text-sm font-bold text-zinc-800">
              {language === 'fr' ? 'Mise en page du document PDF' : 'PDF Document Setup'}
            </h3>

            {/* Orientation */}
            <div>
              <label className="block text-xs font-bold text-zinc-700 mb-1">
                {language === 'fr' ? 'Orientation des pages' : 'Page Orientation'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'portrait', label: 'Portrait (Vertical)', icon: '📱' },
                  { id: 'landscape', label: 'Paysage (Horizontal)', icon: '💻' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setOrientation(opt.id as any)}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all ${
                      orientation === opt.id
                        ? 'bg-pink-50 text-pink-700 border-pink-300'
                        : 'bg-white text-zinc-600 border-zinc-200'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Add More Images Button */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFiles}
              className="hidden"
            />
            <Button
              variant="outline"
              size="md"
              className="w-full justify-center text-xs font-bold"
              onClick={() => fileInputRef.current?.click()}
            >
              + {language === 'fr' ? 'Ajouter des photos / pages' : 'Add Photos / Pages'}
            </Button>

            {/* Download Generated PDF Section */}
            {generatedPdfUrl && (
              <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-2 mt-4">
                <span className="text-xs font-bold text-emerald-800 block">
                  ✓ {language === 'fr' ? 'Document PDF prêt à être téléchargé' : 'PDF Document Ready'}
                </span>
                <a
                  href={generatedPdfUrl}
                  download="document_kazibox.pdf"
                  className="block w-full"
                >
                  <Button variant="primary" size="md" className="w-full justify-center font-bold">
                    ⬇ {language === 'fr' ? 'Télécharger document_kazibox.pdf' : 'Download PDF'}
                  </Button>
                </a>
              </div>
            )}
          </Card>
        </div>

        {/* Selected Pages List */}
        <div className="md:col-span-7 space-y-4">
          <Card padding="lg" className="border-[#E5E7EB] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-zinc-800">
                {language === 'fr' ? 'Pages sélectionnées' : 'Selected Pages'} ({images.length})
              </h3>
              {images.length > 0 && (
                <button
                  type="button"
                  onClick={() => setImages([])}
                  className="text-xs text-red-600 hover:underline font-bold"
                >
                  {language === 'fr' ? 'Tout effacer' : 'Clear All'}
                </button>
              )}
            </div>

            {images.length === 0 ? (
              <div className="py-12 text-center text-zinc-400 space-y-2 border-2 border-dashed border-zinc-200 rounded-2xl">
                <span className="text-3xl block">🖼️</span>
                <p className="text-xs font-medium">
                  {language === 'fr' ? 'Aucune page ajoutée pour le moment.' : 'No images added yet.'}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + {language === 'fr' ? 'Choisir des images' : 'Select Images'}
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {images.map((item, idx) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-2.5 bg-zinc-50 rounded-xl border border-zinc-200 gap-3"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-xs font-mono font-bold text-zinc-400 w-5 text-center">
                        #{idx + 1}
                      </span>
                      <img
                        src={item.previewUrl}
                        alt="Thumbnail"
                        className="w-12 h-12 object-cover rounded-lg border border-black/10 shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-zinc-800 truncate">
                          {item.name}
                        </p>
                        <p className="text-[10px] text-zinc-400">
                          {(item.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        className="w-7 h-7 rounded-lg border border-zinc-200 text-xs font-bold flex items-center justify-center hover:bg-zinc-200 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveDown(idx)}
                        disabled={idx === images.length - 1}
                        className="w-7 h-7 rounded-lg border border-zinc-200 text-xs font-bold flex items-center justify-center hover:bg-zinc-200 disabled:opacity-30"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeImage(item.id)}
                        className="w-7 h-7 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-xs font-bold flex items-center justify-center ml-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
