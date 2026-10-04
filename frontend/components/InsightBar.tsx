"use client";

import { useEffect, useState } from "react";
import { getScheduleInsightMessage } from "../lib/format";

export function InsightBar({
  entityType,
  entityId,
  todayLessonsCount,
  lessons,
}: {
  entityType: "teacher" | "group";
  entityId: number;
  todayLessonsCount: number;
  lessons: import("../lib/api").Lesson[];
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const message = getScheduleInsightMessage(entityType, todayLessonsCount, entityId, now, lessons);

  return (
    <div className="mb-3 mt-2 flex w-full items-center gap-3 rounded-2xl border border-slate-700/50 bg-slate-800/40 px-4 py-3 shadow-sm backdrop-blur-sm transition-colors duration-300 hover:bg-slate-800/60">
      <span className="text-xl leading-none" aria-hidden="true">{message.icon}</span>
      <p className="m-0 text-sm font-medium text-slate-300">{message.text}</p>
    </div>
  );
}
