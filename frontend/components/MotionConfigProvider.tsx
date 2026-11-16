"use client";

import React from "react";
import { LazyMotion, MotionConfig, domMax } from "framer-motion";

export function MotionConfigProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
