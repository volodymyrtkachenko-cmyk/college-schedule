"use client";

import { useEffect, useMemo, useState } from "react";
import { DesktopSpotlightGrid } from "@/components/navigation/DesktopSpotlightGrid";
import { BellIcon, CalendarIcon, ClockIcon } from "@/components/ui/Icons";
import { api, type BellSlotItem, type PublicBellsResponse } from "@/lib/api";

function toMinutes(hhmm: string): number {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number.parseInt(hStr || "0", 10);
  const m = Number.parseInt(mStr || "0", 10);
  return h * 60 + m;
}

function getKyivNowSnapshot() {
  const now = new Date();
  const dateParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const timeParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const weekdayShort = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Kyiv",
    weekday: "short",
  }).format(now);

  const partVal = (parts: Intl.DateTimeFormatPart[], type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const dateIso = `${partVal(dateParts, "year")}-${partVal(dateParts, "month")}-${partVal(dateParts, "day")}`;
  const hour = Number.parseInt(partVal(timeParts, "hour") || "0", 10);
  const minute = Number.parseInt(partVal(timeParts, "minute") || "0", 10);

  return {
    dateIso,
    minutes: (hour === 24 ? 0 : hour) * 60 + minute,
    timeLabel: `${String(hour === 24 ? 0 : hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    isWeekend: weekdayShort === "Sat" || weekdayShort === "Sun",
  };
}

function formatBreakText(slot: BellSlotItem, mode: "standard" | "shortened"): string {
  if (slot.break_after_minutes == null || slot.break_after_minutes <= 0) {
    return "—";
  }
  if (mode === "standard" && slot.break_after_minutes >= 25) {
    return `${slot.break_after_minutes} хв (велика)`;
  }
  return `${slot.break_after_minutes} хв`;
}

function formatShortDateUk(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat("uk-UA", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    weekday: "short",
  }).format(parsed);
}

interface BellsTableCardProps {
  id: string;
  title: string;
  durationBadge: string;
  slots: BellSlotItem[];
  mode: "standard" | "shortened";
  isTodayMode: boolean;
  activeLesson: number | null;
  nextLesson: number | null;
  footnote: string;
  staggerIndex: number;
  icon: "bell" | "clock";
}

function BellsTableCard({
  id,
  title,
  durationBadge,
  slots,
  mode,
  isTodayMode,
  activeLesson,
  nextLesson,
  footnote,
  staggerIndex,
  icon,
}: BellsTableCardProps) {
  return (
    <section
      aria-labelledby={id}
      style={{ "--stagger-index": staggerIndex } as React.CSSProperties}
      className={`interactive-surface desktop-stagger-card rounded-2xl border bg-sys-card p-5 shadow-sm transition-colors ${
        isTodayMode
          ? "border-sys-accent/45 ring-1 ring-sys-accent/15"
          : "border-sys-border"
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-xl border ${
              isTodayMode
                ? "border-sys-accent/30 bg-sys-accent-subtle text-sys-accent"
                : "border-sys-border bg-sys-bg-secondary text-sys-text-secondary"
            }`}
          >
            {icon === "bell" ? (
              <BellIcon className="h-4 w-4" />
            ) : (
              <ClockIcon className="h-4 w-4" />
            )}
          </span>
          <div>
            <h2 id={id} className="text-base font-bold text-sys-text-primary sm:text-lg">
              {title}
            </h2>
          </div>
        </div>
        <span
          className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
            mode === "shortened"
              ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
              : "border-sys-accent/25 bg-sys-accent-subtle text-sys-accent"
          }`}
        >
          {durationBadge}
        </span>
      </div>

      <div
        tabIndex={0}
        role="region"
        aria-label={title}
        className="overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent"
      >
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{title} — розклад пар, час початку, закінчення та тривалість перерв</caption>
          <thead>
            <tr className="border-b border-sys-border text-xs text-sys-text-secondary">
              <th scope="col" className="pb-2 pr-3 font-medium">
                Пара
              </th>
              <th scope="col" className="pb-2 pr-3 font-medium">
                Час
              </th>
              <th scope="col" className="pb-2 font-medium">
                Перерва
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sys-border/60">
            {slots.map((slot) => {
              const isCurrent = isTodayMode && activeLesson === slot.lesson_number;
              const isUpcoming = isTodayMode && nextLesson === slot.lesson_number;
              return (
                <tr
                  key={slot.lesson_number}
                  className={
                    isCurrent
                      ? "bg-sys-accent-subtle/80"
                      : isUpcoming
                      ? "bg-sys-hover/60"
                      : "hover:bg-sys-hover/40"
                  }
                >
                  <th
                    scope="row"
                    className="py-2.5 pr-3 font-semibold text-sys-text-primary"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isCurrent && (
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 rounded-full bg-sys-accent animate-pulse"
                        />
                      )}
                      <span>
                        {slot.lesson_number} пара
                        {slot.is_optional ? " *" : ""}
                      </span>
                    </span>
                  </th>
                  <td className="py-2.5 pr-3 font-mono tabular-nums text-sys-text-primary">
                    {slot.start_time} – {slot.end_time}
                  </td>
                  <td className="py-2.5 text-xs text-sys-text-secondary">
                    {formatBreakText(slot, mode)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-sys-text-secondary">{footnote}</p>
    </section>
  );
}

export function BellsLiveView({ initialData }: { initialData: PublicBellsResponse }) {
  const [data, setData] = useState<PublicBellsResponse>(initialData);
  const [kyivNow, setKyivNow] = useState<{
    dateIso: string;
    minutes: number;
    timeLabel: string;
    isWeekend: boolean;
  } | null>(null);

  useEffect(() => {
    setKyivNow(getKyivNowSnapshot());
    const timer = window.setInterval(() => {
      setKyivNow(getKyivNowSnapshot());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;
    api.settings
      .bells()
      .then((fresh) => {
        if (active && fresh && Array.isArray(fresh.standard) && Array.isArray(fresh.shortened)) {
          setData(fresh);
        }
      })
      .catch(() => {
        // Keep initialData on network error or offline mode
      });
    return () => {
      active = false;
    };
  }, []);

  const todayState = useMemo(() => {
    const todayIso = kyivNow?.dateIso ?? data.today_date;
    const isShortenedToday =
      data.today_date === todayIso
        ? data.is_shortened_today
        : data.upcoming_shortened_days.some((d) => d.date === todayIso);

    const todayReason =
      data.today_date === todayIso
        ? data.today_reason
        : data.upcoming_shortened_days.find((d) => d.date === todayIso)?.reason ?? null;

    const activeSlots = isShortenedToday ? data.shortened : data.standard;

    if (!kyivNow || activeSlots.length === 0) {
      return {
        isShortenedToday,
        todayReason,
        isWeekend: false,
        activeLesson: null as number | null,
        nextLesson: null as number | null,
        progressPct: null as number | null,
        headline: isShortenedToday
          ? "Сьогодні діє скорочений розклад дзвінків (50 хв пара)"
          : "Сьогодні діє стандартний розклад дзвінків (80 хв пара)",
      };
    }

    if (kyivNow.isWeekend) {
      return {
        isShortenedToday,
        todayReason,
        isWeekend: true,
        activeLesson: null,
        nextLesson: null,
        progressPct: null,
        headline: "Вихідний день · пари за розкладом у будні з 09:00",
      };
    }

    const parsed = activeSlots.map((slot) => ({
      ...slot,
      startMin: toMinutes(slot.start_time),
      endMin: toMinutes(slot.end_time),
    }));

    const nowMin = kyivNow.minutes;
    const current = parsed.find((s) => nowMin >= s.startMin && nowMin < s.endMin);
    if (current) {
      const remaining = current.endMin - nowMin;
      const total = Math.max(1, current.endMin - current.startMin);
      const elapsed = Math.min(total, Math.max(0, nowMin - current.startMin));
      return {
        isShortenedToday,
        todayReason,
        isWeekend: false,
        activeLesson: current.lesson_number,
        nextLesson: null,
        progressPct: Math.round((elapsed / total) * 100),
        headline: `Зараз триває ${current.lesson_number} пара (${current.start_time}–${current.end_time}) · до кінця ${remaining} хв`,
      };
    }

    const next = parsed.find((s) => nowMin < s.startMin);
    if (next) {
      const diff = next.startMin - nowMin;
      const isBeforeFirst = next.lesson_number === parsed[0].lesson_number;
      return {
        isShortenedToday,
        todayReason,
        isWeekend: false,
        activeLesson: null,
        nextLesson: next.lesson_number,
        progressPct: null,
        headline: isBeforeFirst
          ? `До початку ${next.lesson_number}-ї пари (${next.start_time}) · ${diff > 60 ? `${Math.floor(diff / 60)} год ${diff % 60} хв` : `${diff} хв`}`
          : `Зараз перерва · ${next.lesson_number} пара о ${next.start_time} (через ${diff} хв)`,
      };
    }

    return {
      isShortenedToday,
      todayReason,
      isWeekend: false,
      activeLesson: null,
      nextLesson: null,
      progressPct: null,
      headline: "Навчальні пари на сьогодні завершились",
    };
  }, [data, kyivNow]);

  const standardDuration = data.standard[0]?.duration_minutes ?? 80;
  const shortenedDuration = data.shortened[0]?.duration_minutes ?? 50;

  return (
    <div className="space-y-6">
      {/* Live-статус дзвінків */}
      <section
        aria-label="Поточний статус дзвінків"
        className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                todayState.activeLesson != null
                  ? "border-sys-accent/30 bg-sys-accent-subtle text-sys-accent"
                  : "border-sys-border bg-sys-bg-secondary text-sys-text-secondary"
              }`}
            >
              <ClockIcon className="h-4.5 w-4.5" />
            </span>
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-sys-text-secondary">
                <span>Зараз у коледжі</span>
                {kyivNow && (
                  <span className="font-mono tabular-nums text-sys-text-muted">
                    · {kyivNow.timeLabel} (Київ)
                  </span>
                )}
              </div>
              <p className="text-sm font-semibold text-sys-text-primary sm:text-base">
                {todayState.headline}
              </p>
              {todayState.todayReason && (
                <p className="text-xs text-sys-text-secondary">
                  Причина: {todayState.todayReason}
                </p>
              )}
            </div>
          </div>

          <span
            className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${
              todayState.isShortenedToday
                ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                : "border-sys-border bg-sys-bg-secondary text-sys-text-primary"
            }`}
          >
            {todayState.isShortenedToday
              ? `Скорочений день · ${shortenedDuration} хв`
              : `Стандартний день · ${standardDuration} хв`}
          </span>
        </div>

        {todayState.progressPct != null && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-sys-border/70">
            <div
              className="h-full rounded-full bg-sys-accent transition-[width] duration-500"
              style={{ width: `${todayState.progressPct}%` }}
            />
          </div>
        )}
      </section>

      {/* Таблиці розкладу дзвінків */}
      <DesktopSpotlightGrid className="grid gap-6 md:grid-cols-2">
        <BellsTableCard
          id="heading-standard-bells"
          title="Стандартні дні"
          durationBadge={`${standardDuration} хв пара`}
          slots={data.standard}
          mode="standard"
          isTodayMode={!todayState.isShortenedToday && !todayState.isWeekend}
          activeLesson={todayState.activeLesson}
          nextLesson={todayState.nextLesson}
          footnote="* 5-та пара призначається факультативно або за індивідуальним розкладом."
          staggerIndex={0}
          icon="bell"
        />

        <BellsTableCard
          id="heading-short-bells"
          title="Скорочені дні"
          durationBadge={`${shortenedDuration} хв пара`}
          slots={data.shortened}
          mode="shortened"
          isTodayMode={todayState.isShortenedToday && !todayState.isWeekend}
          activeLesson={todayState.activeLesson}
          nextLesson={todayState.nextLesson}
          footnote="Застосовується у передсвяткові дні та дні педагогічних нарад за окремим розпорядженням адміністрації."
          staggerIndex={1}
          icon="clock"
        />
      </DesktopSpotlightGrid>

      {/* Заплановані скорочені дні */}
      {data.upcoming_shortened_days.length > 0 && (
        <section
          aria-labelledby="heading-upcoming-shortened"
          className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-sm"
        >
          <div className="mb-3 flex items-center gap-2">
            <CalendarIcon className="h-4 w-4 text-sys-accent" />
            <h2
              id="heading-upcoming-shortened"
              className="text-sm font-bold text-sys-text-primary sm:text-base"
            >
              Найближчі скорочені дні
            </h2>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {data.upcoming_shortened_days.map((item) => (
              <li
                key={item.date}
                className="flex items-center justify-between gap-3 rounded-xl border border-sys-border/70 bg-sys-bg-secondary/50 px-3.5 py-2.5 text-sm"
              >
                <span className="font-medium capitalize text-sys-text-primary">
                  {formatShortDateUk(item.date)}
                </span>
                <span className="text-xs text-sys-text-secondary">
                  {item.reason || "Скорочений день (50 хв)"}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
