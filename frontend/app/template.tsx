"use client";

import React from "react";

/**
 * Надлегка обгортка маршрутів без блокування головного потоку Framer Motion.
 * Використовує апаратну CSS-анімацію прозорості за 120 мс.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen animate-in fade-in duration-150 ease-out">
      {children}
    </div>
  );
}
