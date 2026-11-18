"use client";

import { useState } from "react";
import { ChevronDownIcon } from "@/components/ui/Icons";

export interface FaqItem {
  q: string;
  a: string;
}

export function BellsFaqList({ faqs }: { faqs: FaqItem[] }) {
  const [openIndices, setOpenIndices] = useState<Record<number, boolean>>({});

  const toggleIndex = (idx: number) => {
    setOpenIndices((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  return (
    <div className="space-y-3">
      {faqs.map((faq, idx) => {
        const isOpen = Boolean(openIndices[idx]);
        const panelId = `bells-faq-panel-${idx}`;
        return (
          <div
            key={faq.q}
            className={`scroll-reveal-card rounded-xl border bg-sys-card transition-colors duration-fast ${
              isOpen
                ? "border-sys-accent/60"
                : "border-sys-border hover:border-sys-accent/40"
            }`}
          >
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => toggleIndex(idx)}
              className="flex w-full cursor-pointer items-center justify-between gap-3 p-4 text-left font-medium text-sys-text-primary active:scale-[0.995] transition-transform duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent focus-visible:ring-inset rounded-xl"
            >
              <span>{faq.q}</span>
              <ChevronDownIcon
                className={`h-4 w-4 shrink-0 text-sys-text-secondary transition-transform duration-base [transition-timing-function:var(--ease-desktop-panel)] ${
                  isOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            <div
              id={panelId}
              data-open={isOpen ? "true" : "false"}
              aria-hidden={!isOpen}
              className="tasks-accordion overflow-hidden"
            >
              <div className="tasks-accordion-inner min-h-0 overflow-hidden">
                <p className="tasks-accordion-content px-4 pb-4 text-sm leading-relaxed text-sys-text-secondary">
                  {faq.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
