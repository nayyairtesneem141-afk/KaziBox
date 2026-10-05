'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-red-50 text-red-600 flex items-center justify-center mb-6 shadow-sm font-black text-3xl">
        !
      </div>

      <h1 className="text-3xl font-extrabold text-[#1F2937] mb-3">
        Une erreur est survenue / An Error Occurred
      </h1>
      <p className="text-base text-[#6B7280] max-w-md mb-8">
        Une erreur inattendue s'est produite lors du chargement de l'application.
      </p>

      <button
        onClick={() => reset()}
        className="inline-flex items-center justify-center font-bold rounded-xl px-6 py-3 min-h-[48px] bg-[#6D28D9] text-white hover:bg-[#5B21B6] transition-all shadow-sm cursor-pointer"
      >
        Réessayer / Try Again
      </button>
    </div>
  );
}
