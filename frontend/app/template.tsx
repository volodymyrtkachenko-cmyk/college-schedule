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
      initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        shouldReduceMotion
          ? { duration: 0 }
          : { type: "spring", stiffness: 280, damping: 30, mass: 0.9 }
      }
      className="min-h-screen"
    >
      {children}
    </motion.div>
  );
}
