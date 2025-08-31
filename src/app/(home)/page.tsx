// src/app/(home)/page.tsx
"use client";

import PublicHeader from "@/components/publicHeader";

export default function HomePage() {
  return (
    <div className="relative min-h-screen">
      {/* Header */}
      <PublicHeader showAdminLogin />

      {/* Background image */}
      <div className="absolute inset-0">
        <img
          src="/assets/homepage/home_bg.jpeg"
          alt="Background"
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>

      {/* Dim overlay for readability */}
      <div className="absolute inset-0 bg-black/40" />

      {/* CONTENT */}
      <main className="relative z-10 flex items-center justify-center min-h-screen">
        <h1 className="text-white text-4xl font-bold">Let&apos;s Record</h1>
      </main>
    </div>
  );
}
