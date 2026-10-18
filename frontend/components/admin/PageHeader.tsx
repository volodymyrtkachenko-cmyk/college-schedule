"use client";

import React from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-1">
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <div className="text-[11px] font-bold uppercase tracking-wider text-sys-accent mb-1">
            {eyebrow}
          </div>
        )}
        <h1 className="text-xl sm:text-2xl font-bold text-sys-text-primary tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-xs sm:text-sm text-sys-text-secondary max-w-[70ch]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0 flex-wrap">{actions}</div>}
    </div>
  );
}
