"use client";

import Link from "next/link";
import { ReferenceResource } from "../../lib/api";

export const referenceLabels: Record<ReferenceResource, string> = {
  faculties: "Факультети", groups: "Групи", teachers: "Викладачі", rooms: "Аудиторії", subjects: "Предмети",
};

export function AdminNav({ active }: { active: ReferenceResource }) {
  return <nav aria-label="Адміністрування" className="flex flex-wrap gap-2">
    {(Object.keys(referenceLabels) as ReferenceResource[]).map((resource) => (
      <Link key={resource} href={`/admin?resource=${resource}`} className={`rounded-lg px-3 py-2 text-sm ${active === resource ? "bg-cyan-400/15 text-cyan-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-100"}`}>
        {referenceLabels[resource]}
      </Link>
    ))}
  </nav>;
}
