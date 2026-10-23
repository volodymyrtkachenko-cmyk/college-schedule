"use client";

import React from "react";
import { motion, useReducedMotion } from "framer-motion";

/**
 * Root page template for smooth route-to-route transitions in Next.js App Router.
 * Automatically wraps every navigation (e.g. / <-> /settings <-> /statistics <-> /login)
 * with a subtle 4px micro-slide and smooth cross-fade over 200ms.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.2,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}
