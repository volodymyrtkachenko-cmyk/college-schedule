"use client";

import Link from "next/link";
import { ReferenceResource } from "../../lib/api";

export const referenceLabels: Record<ReferenceResource, string> = {
  faculties: "Спеціальності", groups: "Групи", teachers: "Викладачі", subjects: "Предмети",
};

export function AdminNav({ active }: { active: ReferenceResource }) {
  return (
    <div className="w-full pb-1 mt-1">
      <nav aria-label="Адміністрування" className="flex flex-wrap gap-1 rounded-[8px] bg-sys-card p-1 border-[0.5px] border-sys-border">
        {(Object.keys(referenceLabels) as ReferenceResource[]).map((resource) => (
          <Link key={resource} href={`/admin?resource=${resource}`} className={`flex-1 text-center min-w-[120px] px-3 py-1.5 text-[14px] font-medium rounded-[6px] transition-colors ${active === resource ? "bg-sys-tabActive text-sys-accent shadow-sm" : "text-sys-text-secondary hover:text-sys-text-primary"}`}>
            {referenceLabels[resource]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
