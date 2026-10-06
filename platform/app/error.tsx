'use client';

import React, { useEffect, useState } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    console.error('KaziBox Global Error Boundary:', error);
  }, [error]);

  const handleClearCacheAndReset = () => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.clear();
        sessionStorage.clear();
        window.location.href = '/login';
      }
    } catch {
      reset();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-rose-100 text-rose-600 flex items-center justify-center mb-6 shadow-sm font-black text-3xl">
        ⚠️
      </div>

      <h1 className="text-3xl font-extrabold text-[#1F2937] mb-2 tracking-tight">
        Une erreur est survenue / An Error Occurred
      </h1>
      
      <p className="text-base text-[#6B7280] max-w-md mb-6 leading-relaxed">
        Une erreur inattendue s'est produite lors du chargement de l'application.
      </p>

      {error?.message && (
        <div className="max-w-lg w-full mb-6 text-left">
          <div className="p-4 bg-white rounded-2xl border border-rose-200 shadow-sm text-xs text-rose-900 font-mono overflow-auto max-h-36">
            <p className="font-bold mb-1">Message d'erreur :</p>
            <p>{error.message}</p>
            {error.digest && <p className="text-[10px] text-gray-400 mt-1">Digest: {error.digest}</p>}
          </div>

          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[11px] text-purple-700 font-bold hover:underline mt-2 inline-block"
          >
            {showDetails ? 'Masquer la pile technique' : 'Afficher les détails techniques (stack trace)'}
          </button>

          {showDetails && error.stack && (
            <pre className="mt-2 p-3 bg-gray-900 text-gray-200 rounded-xl text-[10px] font-mono overflow-auto max-h-48 text-left">
              {error.stack}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-3">
        <button
          onClick={() => reset()}
          className="inline-flex items-center justify-center font-bold rounded-xl px-6 py-3 min-h-[48px] bg-[#6D28D9] text-white hover:bg-[#5B21B6] transition-all shadow-md cursor-pointer text-sm"
        >
          🔄 Réessayer / Try Again
        </button>

        <button
          onClick={handleClearCacheAndReset}
          className="inline-flex items-center justify-center font-bold rounded-xl px-6 py-3 min-h-[48px] bg-white border border-[#E5E7EB] text-[#374151] hover:bg-gray-50 transition-all shadow-sm cursor-pointer text-sm"
        >
          🧹 Réinitialiser le cache / Reset Cache
        </button>
      </div>
    </div>
  );
}
