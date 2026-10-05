import React from 'react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-3xl bg-[#F3E8FF] text-[#6D28D9] flex items-center justify-center mb-6 shadow-sm font-black text-3xl">
        404
      </div>

      <h1 className="text-3xl font-extrabold text-[#1F2937] mb-3">
        Page introuvable / Page Not Found
      </h1>
      <p className="text-lg text-[#6B7280] max-w-md mb-8">
        La page demandée n'existe pas ou a été déplacée.
      </p>

      <Link
        href="/dashboard"
        className="inline-flex items-center justify-center font-bold rounded-xl px-6 py-3 min-h-[48px] bg-[#6D28D9] text-white hover:bg-[#5B21B6] transition-all shadow-sm"
      >
        Retour à l'accueil / Back to Home
      </Link>
    </div>
  );
}
