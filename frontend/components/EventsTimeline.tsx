"use client";

import { useEffect, useState } from "react";
import { AcademicEvent, AcademicEventType, api } from "../lib/api";
import { formatRoom, formatTeachers } from "../lib/format";

const EVENT_META: Record<
  AcademicEventType,
  { label: string; icon: string; badgeClass: string; borderClass: string }
> = {
  exam: {
    label: "Екзамен",
    icon: "📝",
    badgeClass: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    borderClass: "border-rose-500/40 bg-gradient-to-r from-rose-500/[0.06] to-sys-card",
  },
  consultation: {
    label: "Консультація",
    icon: "💬",
    badgeClass: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    borderClass: "border-sky-500/30 bg-sys-card",
  },
  credit: {
    label: "Залік",
    icon: "✅",
    badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    borderClass: "border-emerald-500/30 bg-sys-card",
  },
  defense: {
    label: "Захист",
    icon: "🎓",
    badgeClass: "bg-purple-500/15 text-purple-300 border-purple-500/30",
    borderClass: "border-purple-500/35 bg-gradient-to-r from-purple-500/[0.06] to-sys-card",
  },
  general: {
    label: "Подія",
    icon: "📌",
    badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    borderClass: "border-amber-500/30 bg-sys-card",
  },
};

const KYIV_DATE_FMT = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" });
const UK_EVENT_DATE_FMT = new Intl.DateTimeFormat("uk-UA", {
  weekday: "short",
  day: "numeric",
  month: "long",
});

function getDaysDiff(targetDateIso: string, todayIso: string): number {
  const t1 = new Date(`${targetDateIso}T12:00:00`).getTime();
  const t0 = new Date(`${todayIso}T12:00:00`).getTime();
  return Math.round((t1 - t0) / (1000 * 60 * 60 * 24));
}

export function EventsTimeline({
  mode,
  groupId,
  teacherId,
}: {
  mode: "student" | "teacher";
  groupId: number | null;
  teacherId: number | null;
}) {
  const [events, setEvents] = useState<AcademicEvent[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const id = mode === "student" ? groupId : teacherId;
    if (!id) {
      setEvents([]);
      return;
    }
    let active = true;
    const todayIso = KYIV_DATE_FMT.format(new Date());
    api.events
      .list({
        group_id: mode === "student" ? id : undefined,
        teacher_id: mode === "teacher" ? id : undefined,
        from_date: todayIso,
      })
      .then((res) => {
        if (active) setEvents(res);
      })
      .catch(() => {
        if (active) setEvents([]);
      });
    return () => {
      active = false;
    };
  }, [mode, groupId, teacherId]);

  if (events.length === 0) return null;

  const todayIso = KYIV_DATE_FMT.format(new Date());

  return (
    <section className="mb-5 rounded-2xl border border-sys-border bg-sys-card/60 p-3.5 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base" aria-hidden="true">📅</span>
          <h2 className="text-sm font-bold text-sys-text-primary">
            Сесія та призначені події ({events.length})
          </h2>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          className="text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary"
        >
          {collapsed ? "Розгорнути ▼" : "Згорнути ▲"}
        </button>
      </div>

      {!collapsed && (
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {events.map((ev) => {
            const meta = EVENT_META[ev.event_type] ?? EVENT_META.general;
            const diffDays = getDaysDiff(ev.event_date, todayIso);
            const dateFormatted = UK_EVENT_DATE_FMT.format(new Date(`${ev.event_date}T12:00:00`));

            const countdownLabel =
              diffDays === 0
                ? "🔥 Сьогодні"
                : diffDays === 1
                  ? "⏳ Завтра"
                  : diffDays > 1
                    ? `Через ${diffDays} дн.`
                    : "Минуло";

            const who =
              mode === "teacher" && ev.group_name
                ? `Група ${ev.group_name}`
                : ev.teacher_name
                  ? formatTeachers(ev.teacher_name)
                  : null;

            return (
              <div
                key={ev.id}
                className={`flex flex-col justify-between gap-2 rounded-xl border p-3 transition-all ${meta.borderClass} ${
                  diffDays < 0 ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${meta.badgeClass}`}
                  >
                    <span>{meta.icon}</span>
                    <span>{meta.label}</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      diffDays === 0
                        ? "bg-rose-500/20 text-rose-300"
                        : diffDays === 1
                          ? "bg-amber-500/20 text-amber-300"
                          : "bg-white/5 text-sys-text-secondary"
                    }`}
                  >
                    {countdownLabel}
                  </span>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-sys-text-subject">{ev.title}</h3>
                  {ev.note && <p className="mt-0.5 text-xs text-sys-text-muted">{ev.note}</p>}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sys-border/50 pt-2 text-xs text-sys-text-secondary">
                  <span className="font-semibold text-sys-text-primary">
                    {dateFormatted} • {ev.start_time}
                    {ev.end_time ? `–${ev.end_time}` : ""}
                  </span>
                  <div className="flex items-center gap-2">
                    {who && <span>{who}</span>}
                    {ev.room && (
                      <span className="rounded border border-sys-border bg-sys-tabActive px-1.5 py-0.5 font-medium text-sys-text-primary">
                        🚪 {formatRoom(ev.room)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
