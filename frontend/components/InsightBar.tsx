"use client";

import { useEffect, useState } from "react";
import { getScheduleInsightMessage } from "../lib/format";

export function InsightBar({
  entityType,
  todayLessonsCount,
}: {
  entityType: "teacher" | "group";
  todayLessonsCount: number;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const message = getScheduleInsightMessage(entityType, todayLessonsCount, now);

  return (
    <div className="mx-auto mb-5 mt-4 flex w-full max-w-3xl items-center gap-3 rounded-xl border border-slate-700/50 bg-slate-800/40 px-4 py-3 shadow-sm backdrop-blur-sm transition-colors duration-300 hover:bg-slate-800/60">
      <span className="text-xl leading-none" aria-hidden="true">{message.icon}</span>
      <p className="m-0 text-sm font-medium text-slate-300">{message.text}</p>
    </div>
  );
}
