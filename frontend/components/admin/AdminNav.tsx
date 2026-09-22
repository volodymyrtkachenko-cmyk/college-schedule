"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, ReferenceResource } from "../../lib/api";

export const referenceLabels: Record<ReferenceResource, string> = {
  faculties: "Спеціальності", groups: "Групи", teachers: "Викладачі", subjects: "Предмети",
};

export function AdminNav({ active }: { active: ReferenceResource | "schedule" }) {
  const [online, setOnline] = useState<number | null>(null);

  useEffect(() => {
    // Poll online metrics every 5 seconds
    const fetchMetrics = async () => {
      try {
        const session = await api.auth.ensureAuthenticated();
        const data = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "https://college-schedule-dpyg.onrender.com"}/api/admin/metrics`, {
          headers: { "Authorization": `Bearer ${session.access_token}` }
        }).then(res => res.json());
        setOnline(data.online);
      } catch (e) {
        // fail silently
      }
    };
    fetchMetrics();
    const iv = setInterval(fetchMetrics, 7000);
    return () => clearInterval(iv);
  }, []);

  const resources = Object.keys(referenceLabels) as ReferenceResource[];

  return (
    <div className="w-full pb-1 mt-1 space-y-2">
      <div className="flex items-center justify-end px-1">
          <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 shadow-sm">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
            </span>
            <span className="text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
              Користувачів на сайті: {online !== null ? <b className="ml-0.5">{online}</b> : "..."}
            </span>
          </div>
      </div>
      <nav aria-label="Адміністрування" className="flex flex-wrap gap-1 rounded-[8px] bg-sys-card p-1 border-[0.5px] border-sys-border">
        <Link 
          href={`/admin?resource=schedule`} 
          className={`flex-1 text-center min-w-[120px] px-3 py-1.5 text-[14px] font-bold rounded-[6px] transition-colors ${active === "schedule" ? "bg-sys-accent text-[#0b1120] shadow-md shadow-sys-accent/20" : "text-sys-text-secondary hover:text-sys-text-primary"}`}
        >
          Розклад
        </Link>
        {resources.map((resource) => (
          <Link key={resource} href={`/admin?resource=${resource}`} className={`flex-1 text-center min-w-[120px] px-3 py-1.5 text-[14px] font-medium rounded-[6px] transition-colors ${active === resource ? "bg-sys-tabActive text-sys-accent shadow-sm" : "text-sys-text-secondary hover:text-sys-text-primary"}`}>
            {referenceLabels[resource]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
