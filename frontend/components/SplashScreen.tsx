"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import Image from "next/image";

interface SplashScreenProps {
  isLoading: boolean;
  minDurationMs?: number;
}

export function SplashScreen({ isLoading, minDurationMs = 500 }: SplashScreenProps) {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, minDurationMs);
    return () => clearTimeout(timer);
  }, [minDurationMs]);

  // Keep splash visible while app is loading OR until minimum smooth animation duration finishes
  const isVisible = isLoading || !minTimeElapsed;

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="pwa-splash"
          initial={{ opacity: 1 }}
          exit={{
            opacity: 0,
            scale: shouldReduceMotion ? 1 : 0.98,
            transition: { duration: shouldReduceMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] },
          }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0a0d14] select-none pointer-events-auto"
          aria-label="Завантаження розкладу"
          role="status"
        >
          {/* Ambient radial lighting */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 45%, rgba(56, 189, 248, 0.15) 0%, rgba(99, 102, 241, 0.08) 35%, transparent 70%)",
            }}
          />

          {/* Subtle tech background grid dots */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.03]"
            style={{
              backgroundImage: "radial-gradient(#38bdf8 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />

          {/* Central Logo Container */}
          <div className="relative z-10 flex flex-col items-center px-6 text-center">
            {/* Glowing Icon Frame */}
            <motion.div
              initial={{ scale: shouldReduceMotion ? 1 : 0.88, opacity: 0 }}
              animate={{
                scale: 1,
                opacity: 1,
                transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] },
              }}
              className="relative mb-6"
            >
              {/* Outer neon breathing aura */}
              <motion.div
                animate={
                  shouldReduceMotion
                    ? {}
                    : {
                        scale: [1, 1.08, 1],
                        opacity: [0.4, 0.7, 0.4],
                      }
                }
                transition={{
                  duration: 2.4,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="absolute -inset-2.5 rounded-[32px] bg-gradient-to-tr from-sky-500/30 via-cyan-400/20 to-indigo-500/30 blur-xl"
              />

              {/* Icon squircle with glassmorphic border */}
              <div className="relative h-24 w-24 sm:h-28 sm:w-28 overflow-hidden rounded-[26px] border border-sky-400/30 bg-[#0f1422] p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.6),0_0_24px_rgba(56,189,248,0.25)] ring-1 ring-white/10">
                <Image
                  src="/icon-192.png"
                  alt="ДФКР Розклад"
                  width={112}
                  height={112}
                  priority
                  className="h-full w-full object-cover rounded-[20px]"
                />
              </div>
            </motion.div>

            {/* Brand Title */}
            <motion.div
              initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: 0.15, duration: 0.45 } }}
              className="space-y-1.5 mb-8"
            >
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white flex items-center justify-center gap-2">
                <span>ДФКР</span>
                <span className="bg-gradient-to-r from-sky-400 via-cyan-300 to-indigo-400 bg-clip-text text-transparent">
                  Розклад
                </span>
              </h1>
              <p className="text-xs sm:text-sm font-medium tracking-wide text-slate-400 max-w-xs">
                Фаховий коледж електронних приладів
              </p>
            </motion.div>

            {/* Thin Gradient Loading Bar */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { delay: 0.25, duration: 0.3 } }}
              className="relative h-1 w-36 sm:w-44 overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-white/5"
            >
              <motion.div
                animate={
                  shouldReduceMotion
                    ? {}
                    : {
                        x: ["-100%", "100%"],
                      }
                }
                transition={{
                  duration: 1.2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
                className="absolute inset-y-0 w-1/2 rounded-full bg-gradient-to-r from-sky-500 via-cyan-300 to-indigo-500 shadow-[0_0_12px_rgba(56,189,248,0.8)]"
              />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
