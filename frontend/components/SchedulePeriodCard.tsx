"use client";

import React, { useMemo } from "react";
import { SchedulePeriodInfo } from "../lib/api";
import { UKR_DAY_MONTH_LONG_FMT } from "../lib/date";

interface SchedulePeriodCardProps {
  period: SchedulePeriodInfo;
  isToday?: boolean;
}

export function getPeriodMeta(period: SchedulePeriodInfo) {
  switch (period.period_type) {
    case "practice":
      return {
        icon: "🛠️",
        badgeLabel: "Виробнича практика",
        shortLabel: "Практика",
        badgeTone: "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-300",
        cardBorder: "border-amber-500/30",
        cardBg: "bg-gradient-to-br from-amber-950/20 via-sys-card to-sys-card",
        title: period.name || "Виробнича практика",
        description: "Навчальні заняття за розкладом замінено проходженням практики на підприємствах або базах практики коледжу.",
        hint: "Не забувайте своєчасно заповнювати щоденник практики та формувати звіт.",
      };
    case "session":
      return {
        icon: "📝",
        badgeLabel: "Екзаменаційна сесія",
        shortLabel: "Сесія",
        badgeTone: "border-purple-500/40 bg-purple-500/15 text-purple-800 dark:text-purple-300",
        cardBorder: "border-purple-500/30",
        cardBg: "bg-gradient-to-br from-purple-950/20 via-sys-card to-sys-card",
        title: period.name || "Екзаменаційна сесія",
        description: "Період складання заліків, консультацій та екзаменів.",
        hint: "Розклад консультацій та екзаменів призначається навчальною частиною.",
      };
    case "holiday":
      return {
        icon: "🌴",
        badgeLabel: "Канікули",
        shortLabel: "Канікули",
        badgeTone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300",
        cardBorder: "border-emerald-500/30",
        cardBg: "bg-gradient-to-br from-emerald-950/20 via-sys-card to-sys-card",
        title: period.name || "Канікули",
        description: "Навчальні заняття не проводяться. Бажаємо гарного відпочинку!",
        hint: null,
      };
    case "diploma":
      return {
        icon: "🎓",
        badgeLabel: "Дипломне проектування",
        shortLabel: "Диплом",
        badgeTone: "border-sky-500/40 bg-sky-500/15 text-sky-800 dark:text-sky-300",
        cardBorder: "border-sky-500/30",
        cardBg: "bg-gradient-to-br from-sky-950/20 via-sys-card to-sys-card",
        title: period.name || "Дипломне проектування",
        description: "Підготовка та оформлення дипломного проєкту (роботи) під керівництвом викладачів.",
        hint: "Звертайтесь до керівника дипломного проєкту за консультаціями.",
      };
    case "attestation":
      return {
        icon: "🏛️",
        badgeLabel: "Державна атестація",
        shortLabel: "Атестація",
        badgeTone: "border-rose-500/40 bg-rose-500/15 text-rose-800 dark:text-rose-300",
        cardBorder: "border-rose-500/30",
        cardBg: "bg-gradient-to-br from-rose-950/20 via-sys-card to-sys-card",
        title: period.name || "Державна атестація",
        description: "Складання кваліфікаційних іспитів та захист дипломних робіт перед державною комісією.",
        hint: null,
      };
    default:
      return {
        icon: "📅",
        badgeLabel: "Навчальний період",
        shortLabel: "Період",
        badgeTone: "border-sys-border bg-sys-tabActive text-sys-text-primary",
        cardBorder: "border-sys-border",
        cardBg: "bg-sys-card",
        title: period.name || "Спеціальний період",
        description: "Навчальні заняття за базовим розкладом тимчасово призупинені.",
        hint: null,
      };
  }
}

export function formatDateRange(startIso: string, endIso: string): string {
  try {
    const s = new Date(`${startIso}T12:00:00`);
    const e = new Date(`${endIso}T12:00:00`);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) {
      return `${startIso} — ${endIso}`;
    }
    const startStr = UKR_DAY_MONTH_LONG_FMT.format(s);
    const endStr = UKR_DAY_MONTH_LONG_FMT.format(e);
    return `${startStr} — ${endStr}`;
  } catch {
    return `${startIso} — ${endIso}`;
  }
}

export function CompactSchedulePeriodCard({
  period,
  onClick,
}: {
  period: SchedulePeriodInfo;
  onClick?: () => void;
}) {
  const meta = useMemo(() => getPeriodMeta(period), [period]);
  const dateRangeStr = useMemo(
    () => formatDateRange(period.start_date, period.end_date),
    [period.start_date, period.end_date]
  );

  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`flex flex-col items-center justify-center rounded-2xl border ${meta.cardBorder} ${meta.cardBg} p-4 text-center min-h-[170px] h-full shadow-xs gap-1.5 transition-all duration-fast ${
        onClick ? "cursor-pointer hover:border-sys-accent/60 active:scale-[0.99]" : ""
      }`}
    >
      <span className="text-2xl select-none">{meta.icon}</span>
      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border shadow-xs ${meta.badgeTone}`}>
        {meta.shortLabel}
      </span>
      <span className="text-xs font-semibold text-sys-text-primary line-clamp-2 mt-1">
        {meta.title}
      </span>
      <span className="text-[11px] text-sys-text-secondary mt-0.5">
        {dateRangeStr}
      </span>
    </div>
  );
}

export function SchedulePeriodCard({ period, isToday = false }: SchedulePeriodCardProps) {
  const meta = useMemo(() => getPeriodMeta(period), [period]);

  const dateRangeStr = useMemo(
    () => formatDateRange(period.start_date, period.end_date),
    [period.start_date, period.end_date]
  );

  return (
    <div
      className={`flex flex-col rounded-2xl border ${meta.cardBorder} ${meta.cardBg} p-5 sm:p-6 shadow-md transition-all my-auto max-w-xl mx-auto w-full text-left`}
    >
      {/* Top Header Badge & Dates */}
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3.5">
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shadow-xs ${meta.badgeTone}`}>
          <span>{meta.icon}</span>
          <span>{meta.badgeLabel}</span>
        </span>

        <span className="text-xs font-semibold text-sys-text-secondary bg-sys-bg/60 border border-sys-border/50 px-2.5 py-1 rounded-lg">
          {dateRangeStr}
        </span>
      </div>

      {/* Title */}
      <h3 className="text-lg sm:text-xl font-bold text-sys-text-primary tracking-tight leading-snug mb-2">
        {meta.title}
      </h3>

      {/* Description */}
      <p className="text-xs sm:text-sm text-sys-text-secondary leading-relaxed mb-4">
        {meta.description}
      </p>

      {/* Helpful Hint box if applicable */}
      {meta.hint && (
        <div className="flex items-start gap-2.5 rounded-xl border border-sys-border/60 bg-sys-bg/60 px-3.5 py-2.5 text-xs text-sys-text-secondary">
          <span className="text-sys-accent shrink-0 text-sm">💡</span>
          <span className="leading-relaxed">{meta.hint}</span>
        </div>
      )}
    </div>
  );
}
