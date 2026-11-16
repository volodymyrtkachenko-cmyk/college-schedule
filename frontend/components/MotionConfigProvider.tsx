"use client";

import React from "react";
import { LazyMotion, MotionConfig } from "framer-motion";

const loadMotionFeatures = () =>
  import("../lib/motionFeatures").then((mod) => mod.default);

export function MotionConfigProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={loadMotionFeatures} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
