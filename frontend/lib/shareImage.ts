import { ScheduleResponse } from "./api";
import { calendarDateIsoToUtcDate } from "./calendarDate";
import { formatLessonDetails, formatFullWeekRange } from "./format";
import { getPeriodMeta, formatDateRange } from "../components/SchedulePeriodCard";

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawLeftAccentStrip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  cardRadius: number,
  color: string
) {
  ctx.save();
  drawRoundedRect(ctx, x, y, 12, h, cardRadius);
  ctx.clip();
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 3.5, h);
  ctx.restore();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    } else {
      current = test;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  // Truncate final line with ellipsis if overflowing
  if (lines.length > 0) {
    const lastIdx = lines.length - 1;
    let last = lines[lastIdx];
    while (last.length > 3 && ctx.measureText(last).width > maxWidth) {
      last = last.slice(0, -2).trimEnd() + "…";
    }
    lines[lastIdx] = last;
  }
  return lines.slice(0, maxLines);
}

function truncateLine(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  let out = text;
  while (out.length > 3 && ctx.measureText(out).width > maxWidth) {
    out = out.slice(0, -2).trimEnd() + "…";
  }
  return out;
}

function resolveTheme(explicitTheme?: "light" | "dark"): "light" | "dark" {
  if (explicitTheme) return explicitTheme;
  if (typeof document !== "undefined") {
    const doc = document.documentElement;
    if (doc.classList.contains("light") || doc.getAttribute("data-theme") === "light") {
      return "light";
    }
  }
  return "dark";
}

function parseRgbTriplet(raw: string): [number, number, number] | null {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map((n) => Number(n));
  if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) {
    return null;
  }
  return [
    Math.max(0, Math.min(255, Math.round(parts[0]))),
    Math.max(0, Math.min(255, Math.round(parts[1]))),
    Math.max(0, Math.min(255, Math.round(parts[2]))),
  ];
}

function rgbStr(rgb: [number, number, number], alpha = 1): string {
  return alpha >= 1
    ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    : `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

interface ImageThemePalette {
  isDark: boolean;
  canvasBg: string;
  cardBg: string;
  cardBorder: string;
  headerBorder: string;
  titlePrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  headerBadgeBg: string;
  headerBadgeBorder: string;
  headerBadgeText: string;
  slotEmptyBg: string;
  slotEmptyBorder: string;
  slotEmptyText: string;
  roomChipBg: string;
  roomChipBorder: string;
  roomChipText: string;
  repBg: string;
  repBorder: string;
  repText: string;
  cancelledBg: string;
  cancelledBorder: string;
  cancelledText: string;
  timeLine: string;
  footerText: string;
  shortenedBadgeBg: string;
  shortenedBadgeBorder: string;
  shortenedBadgeText: string;
  overrideOfflineBg: string;
  overrideOfflineText: string;
  overrideOnlineBg: string;
  overrideOnlineText: string;
}

type ImageAccent = "blue" | "emerald" | "violet" | "amber" | "rose" | "cyan";

function resolveAccent(): ImageAccent {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-accent") as ImageAccent | null;
    if (attr && ["blue", "emerald", "violet", "amber", "rose", "cyan"].includes(attr)) {
      return attr;
    }
  }
  return "blue";
}

function getThemePalette(theme: "light" | "dark"): ImageThemePalette {
  const accent = resolveAccent();

  const lightAccents: Record<
    ImageAccent,
    { bg: string; border: string; text: string; secondary: string; muted: string; accent: string; chipBg: string }
  > = {
    blue:    { bg: "#eef4fc", border: "#c5d7f2", text: "#0f1a33", secondary: "#2e4061", muted: "#4a5f82", accent: "#1d4ed8", chipBg: "#e6f0fd" },
    emerald: { bg: "#ebf7f1", border: "#b8e0cd", text: "#0b241b", secondary: "#244a3b", muted: "#3f6958", accent: "#047857", chipBg: "#e0f4ea" },
    violet:  { bg: "#f3effe", border: "#d2c4f7", text: "#1d1238", secondary: "#413066", muted: "#604c8a", accent: "#6d28d9", chipBg: "#ece4fe" },
    amber:   { bg: "#fbf4e6", border: "#e8cf9d", text: "#2b1a08", secondary: "#573a1a", muted: "#78552d", accent: "#b45309", chipBg: "#f9edd4" },
    rose:    { bg: "#fbeef2", border: "#edbbc9", text: "#2e0e19", secondary: "#5e283a", muted: "#804156", accent: "#be123c", chipBg: "#f9e1e8" },
    cyan:    { bg: "#eaf6f9", border: "#b3dce6", text: "#0c232e", secondary: "#24495c", muted: "#40687d", accent: "#0e7490", chipBg: "#ddf1f6" },
  };

  const darkAccents: Record<
    ImageAccent,
    { bg: string; card: string; border: string; text: string; secondary: string; muted: string; accent: string; chipBg: string }
  > = {
    blue:    { bg: "#080d18", card: "#111a2e", border: "#203152", text: "#f4f8ff", secondary: "#bacbe3", muted: "#90a5c4", accent: "#60a5fa", chipBg: "#182540" },
    emerald: { bg: "#06120e", card: "#0d211a", border: "#1b4033", text: "#f0fdf8", secondary: "#b6d9cb", muted: "#8ab5a4", accent: "#34d399", chipBg: "#143026" },
    violet:  { bg: "#0d0917", card: "#17112b", border: "#312357", text: "#f8f5ff", secondary: "#cabee6", muted: "#a494c9", accent: "#c084fc", chipBg: "#231940" },
    amber:   { bg: "#120d06", card: "#21180b", border: "#423017", text: "#fffaf0", secondary: "#deccb1", muted: "#b8a282", accent: "#fbbf24", chipBg: "#302311" },
    rose:    { bg: "#13080d", card: "#24101a", border: "#472033", text: "#fff5f7", secondary: "#e0bfcc", muted: "#ba93a3", accent: "#fb7185", chipBg: "#341726" },
    cyan:    { bg: "#061117", card: "#0c202b", border: "#193e52", text: "#f0fbff", secondary: "#b4d4e3", muted: "#88b0c2", accent: "#22d3ee", chipBg: "#132e3d" },
  };

  const fallback: ImageThemePalette =
    theme === "light"
      ? (() => {
          const a = lightAccents[accent];
          return {
            isDark: false,
            canvasBg: a.bg,
            cardBg: "#ffffff",
            cardBorder: a.border,
            headerBorder: a.border,
            titlePrimary: a.text,
            textSecondary: a.secondary,
            textMuted: a.muted,
            accent: a.accent,
            headerBadgeBg: a.chipBg,
            headerBadgeBorder: a.border,
            headerBadgeText: a.accent,
            slotEmptyBg: "rgba(255, 255, 255, 0.55)",
            slotEmptyBorder: a.border,
            slotEmptyText: a.muted,
            roomChipBg: a.chipBg,
            roomChipBorder: a.border,
            roomChipText: a.secondary,
            repBg: "rgba(254, 243, 199, 0.7)",
            repBorder: "rgba(234, 88, 12, 0.45)",
            repText: "#9a3412",
            cancelledBg: "rgba(148, 163, 184, 0.12)",
            cancelledBorder: "rgba(148, 163, 184, 0.35)",
            cancelledText: "#64748b",
            timeLine: a.border,
            footerText: a.muted,
            shortenedBadgeBg: "rgba(254, 243, 199, 0.9)",
            shortenedBadgeBorder: "rgba(245, 158, 11, 0.4)",
            shortenedBadgeText: "#b45309",
            overrideOfflineBg: a.chipBg,
            overrideOfflineText: a.accent,
            overrideOnlineBg: "rgba(217, 119, 6, 0.12)",
            overrideOnlineText: "#b45309",
          };
        })()
      : (() => {
          const d = darkAccents[accent];
          return {
            isDark: true,
            canvasBg: d.bg,
            cardBg: d.card,
            cardBorder: d.border,
            headerBorder: d.border,
            titlePrimary: d.text,
            textSecondary: d.secondary,
            textMuted: d.muted,
            accent: d.accent,
            headerBadgeBg: d.chipBg,
            headerBadgeBorder: d.border,
            headerBadgeText: d.accent,
            slotEmptyBg: "rgba(255, 255, 255, 0.025)",
            slotEmptyBorder: d.border,
            slotEmptyText: d.muted,
            roomChipBg: d.chipBg,
            roomChipBorder: d.border,
            roomChipText: d.text,
            repBg: "rgba(234, 88, 12, 0.14)",
            repBorder: "rgba(251, 146, 60, 0.5)",
            repText: "#fdba74",
            cancelledBg: "rgba(148, 163, 184, 0.06)",
            cancelledBorder: "rgba(148, 163, 184, 0.25)",
            cancelledText: "#94a3b8",
            timeLine: d.border,
            footerText: d.muted,
            shortenedBadgeBg: "rgba(245, 158, 11, 0.18)",
            shortenedBadgeBorder: "rgba(245, 158, 11, 0.4)",
            shortenedBadgeText: "#fcd34d",
            overrideOfflineBg: d.chipBg,
            overrideOfflineText: d.accent,
            overrideOnlineBg: "rgba(245, 158, 11, 0.16)",
            overrideOnlineText: "#fcd34d",
          };
        })();

  // Inherit exact live Appearance Studio tokens (including custom hue & OLED surface)
  if (typeof document !== "undefined" && typeof getComputedStyle === "function") {
    const doc = document.documentElement;
    const domIsLight =
      doc.classList.contains("light") || doc.getAttribute("data-theme") === "light";
    if ((theme === "light") === domIsLight) {
      const styles = getComputedStyle(doc);
      const bg = parseRgbTriplet(styles.getPropertyValue("--sys-bg"));
      const card = parseRgbTriplet(styles.getPropertyValue("--sys-card"));
      const border = parseRgbTriplet(styles.getPropertyValue("--sys-border"));
      const textPrimary = parseRgbTriplet(styles.getPropertyValue("--sys-text-primary"));
      const textSecondary = parseRgbTriplet(styles.getPropertyValue("--sys-text-secondary"));
      const textMuted = parseRgbTriplet(styles.getPropertyValue("--sys-text-muted"));
      const sysAccent = parseRgbTriplet(styles.getPropertyValue("--sys-accent"));
      const surface = parseRgbTriplet(styles.getPropertyValue("--sys-surface"));

      if (bg && card && border && textPrimary && textSecondary && textMuted && sysAccent) {
        const chipBase = surface || card;
        return {
          ...fallback,
          canvasBg: rgbStr(bg),
          cardBg: rgbStr(card),
          cardBorder: rgbStr(border),
          headerBorder: rgbStr(border),
          titlePrimary: rgbStr(textPrimary),
          textSecondary: rgbStr(textSecondary),
          textMuted: rgbStr(textMuted),
          accent: rgbStr(sysAccent),
          headerBadgeBg: rgbStr(sysAccent, theme === "light" ? 0.11 : 0.15),
          headerBadgeBorder: rgbStr(sysAccent, 0.35),
          headerBadgeText: rgbStr(sysAccent),
          slotEmptyBg: theme === "light" ? "rgba(255, 255, 255, 0.55)" : rgbStr(card, 0.45),
          slotEmptyBorder: rgbStr(border),
          slotEmptyText: rgbStr(textMuted),
          roomChipBg: rgbStr(chipBase),
          roomChipBorder: rgbStr(border),
          roomChipText: theme === "light" ? rgbStr(textSecondary) : rgbStr(textPrimary),
          timeLine: rgbStr(border),
          footerText: rgbStr(textMuted),
          overrideOfflineBg: rgbStr(sysAccent, theme === "light" ? 0.12 : 0.16),
          overrideOfflineText: rgbStr(sysAccent),
        };
      }
    }
  }

  return fallback;
}

function getPeriodColor(periodType: string, isDark: boolean) {
  switch (periodType) {
    case "practice":
      return {
        bg: isDark ? "rgba(245, 158, 11, 0.10)" : "#fffbeb",
        border: isDark ? "rgba(245, 158, 11, 0.35)" : "#fde68a",
        badgeBg: isDark ? "rgba(245, 158, 11, 0.20)" : "#fef3c7",
        badgeBorder: isDark ? "rgba(245, 158, 11, 0.40)" : "#fcd34d",
        text: isDark ? "#fbbf24" : "#b45309",
      };
    case "session":
      return {
        bg: isDark ? "rgba(168, 85, 247, 0.10)" : "#faf5ff",
        border: isDark ? "rgba(168, 85, 247, 0.35)" : "#e9d5ff",
        badgeBg: isDark ? "rgba(168, 85, 247, 0.20)" : "#f3e8ff",
        badgeBorder: isDark ? "rgba(168, 85, 247, 0.40)" : "#d8b4fe",
        text: isDark ? "#c084fc" : "#7e22ce",
      };
    case "holiday":
      return {
        bg: isDark ? "rgba(16, 185, 129, 0.10)" : "#f0fdf4",
        border: isDark ? "rgba(16, 185, 129, 0.35)" : "#bbf7d0",
        badgeBg: isDark ? "rgba(16, 185, 129, 0.20)" : "#dcfce7",
        badgeBorder: isDark ? "rgba(16, 185, 129, 0.40)" : "#86efac",
        text: isDark ? "#34d399" : "#047857",
      };
    case "diploma":
      return {
        bg: isDark ? "rgba(14, 165, 233, 0.10)" : "#f0f9ff",
        border: isDark ? "rgba(14, 165, 233, 0.35)" : "#bae6fd",
        badgeBg: isDark ? "rgba(14, 165, 233, 0.20)" : "#e0f2fe",
        badgeBorder: isDark ? "rgba(14, 165, 233, 0.40)" : "#7dd3fc",
        text: isDark ? "#38bdf8" : "#0369a1",
      };
    case "attestation":
      return {
        bg: isDark ? "rgba(244, 63, 94, 0.10)" : "#fff1f2",
        border: isDark ? "rgba(244, 63, 94, 0.35)" : "#fecdd3",
        badgeBg: isDark ? "rgba(244, 63, 94, 0.20)" : "#ffe4e6",
        badgeBorder: isDark ? "rgba(244, 63, 94, 0.40)" : "#fda4af",
        text: isDark ? "#fb7185" : "#be123c",
      };
    default:
      return {
        bg: isDark ? "rgba(24, 24, 27, 0.6)" : "#f8fafc",
        border: isDark ? "#27272a" : "#e2e8f0",
        badgeBg: isDark ? "#27272a" : "#f1f5f9",
        badgeBorder: isDark ? "#3f3f46" : "#cbd5e1",
        text: isDark ? "#e4e4e7" : "#334155",
      };
  }
}

function drawStatusPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bg: string,
  border: string,
  color: string,
  height = 20,
  radius = 6
): number {
  ctx.font = "700 10px Inter, system-ui, sans-serif";
  const w = ctx.measureText(text).width + 12;
  drawRoundedRect(ctx, x, y, w, height, radius);
  ctx.fillStyle = bg;
  ctx.fill();
  if (border) {
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x + 6, y + height / 2 + 3.5);
  return w;
}

export async function generateScheduleCardBlob(
  schedule: ScheduleResponse,
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekNumber?: number | null,
  theme?: "light" | "dark"
): Promise<Blob> {
  const effectiveTheme = resolveTheme(theme);
  const p = getThemePalette(effectiveTheme);

  const scale = 2;
  const width = 540;
  const padding = 24;
  const cardGap = 10;
  const cardHeight = 88;

  const hasSubChips = Boolean(schedule.is_shortened_day || schedule.learning_mode_override);
  const headerBottomY = hasSubChips ? 106 : 86;

  const lessons = [...schedule.lessons].sort(
    (a, b) => a.lesson_number - b.lesson_number || a.id - b.id
  );
  const isPeriodDay = Boolean(schedule.period_info && lessons.length === 0);
  const contentHeight = isPeriodDay
    ? 150
    : lessons.length > 0
    ? lessons.length * cardHeight + (lessons.length - 1) * cardGap
    : 84;
  const height = headerBottomY + 14 + contentHeight + 44;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

  // 1. Фон полотна
  ctx.fillStyle = p.canvasBg;
  ctx.fillRect(0, 0, width, height);

  // 2. Шапка картки (Kyiv TZ safe)
  const dateObj = calendarDateIsoToUtcDate(schedule.date);
  const dateFormatted = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateObj);
  const titleDate = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  ctx.fillStyle = p.accent;
  ctx.font = "700 12px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText((ownerLabel || "РОЗКЛАД ЗАНЯТЬ").toUpperCase(), padding, 32);

  const weekTypeUk =
    schedule.week_type === "numerator"
      ? "чисельник"
      : schedule.week_type === "denominator"
      ? "знаменник"
      : "";

  let fullWeekBadge = "";
  if (weekNumber && weekTypeUk) {
    fullWeekBadge = `${weekNumber} тиждень · ${weekTypeUk}`;
  } else if (weekNumber) {
    fullWeekBadge = `${weekNumber} тиждень`;
  } else if (weekTypeUk) {
    fullWeekBadge = weekTypeUk.charAt(0).toUpperCase() + weekTypeUk.slice(1);
  }

  let badgeLeftX = width - padding;
  if (fullWeekBadge) {
    ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
    const badgeW = ctx.measureText(fullWeekBadge).width + 20;
    badgeLeftX = width - padding - badgeW;
    drawRoundedRect(ctx, badgeLeftX, 42, badgeW, 26, 13);
    ctx.fillStyle = p.headerBadgeBg;
    ctx.fill();
    ctx.strokeStyle = p.headerBadgeBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.headerBadgeText;
    ctx.fillText(fullWeekBadge, badgeLeftX + 10, 59);
  }

  const maxTitleW = Math.max(140, badgeLeftX - padding - 12);
  ctx.fillStyle = p.titlePrimary;
  ctx.font = "800 21px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(truncateLine(ctx, titleDate, maxTitleW), padding, 62);

  if (hasSubChips) {
    let chipX = padding;
    const chipY = 74;
    if (schedule.is_shortened_day) {
      const w = drawStatusPill(
        ctx,
        chipX,
        chipY,
        "⏱ 50 хв · скорочений день",
        p.shortenedBadgeBg,
        p.shortenedBadgeBorder,
        p.shortenedBadgeText,
        21,
        7
      );
      chipX += w + 8;
    }
    if (schedule.learning_mode_override) {
      const isOff = schedule.learning_mode_override.mode === "offline";
      drawStatusPill(
        ctx,
        chipX,
        chipY,
        isOff ? "🏫 Очно" : "💻 Дистанційно",
        isOff ? p.overrideOfflineBg : p.overrideOnlineBg,
        isOff ? p.headerBadgeBorder : p.shortenedBadgeBorder,
        isOff ? p.overrideOfflineText : p.overrideOnlineText,
        21,
        7
      );
    }
  }

  // Розділювач шапки
  ctx.strokeStyle = p.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, headerBottomY);
  ctx.lineTo(width - padding, headerBottomY);
  ctx.stroke();

  // 3. Список пар або спеціальний період
  let currentY = headerBottomY + 14;

  if (isPeriodDay && schedule.period_info) {
    const meta = getPeriodMeta(schedule.period_info);
    const dateRangeStr = formatDateRange(schedule.period_info.start_date, schedule.period_info.end_date);
    const pColor = getPeriodColor(schedule.period_info.period_type, p.isDark);
    const cardW = width - padding * 2;

    drawRoundedRect(ctx, padding, currentY, cardW, contentHeight, 16);
    ctx.fillStyle = pColor.bg;
    ctx.fill();
    ctx.strokeStyle = pColor.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.font = "700 11px Inter, system-ui, sans-serif";
    const badgeStr = `${meta.icon} ${meta.badgeLabel}`;
    const badgeW = ctx.measureText(badgeStr).width + 16;
    drawRoundedRect(ctx, padding + 16, currentY + 16, badgeW, 24, 12);
    ctx.fillStyle = pColor.badgeBg;
    ctx.fill();
    ctx.strokeStyle = pColor.badgeBorder;
    ctx.stroke();
    ctx.fillStyle = pColor.text;
    ctx.fillText(badgeStr, padding + 24, currentY + 32);

    const dateW = ctx.measureText(dateRangeStr).width + 16;
    const dateX = width - padding - 16 - dateW;
    drawRoundedRect(ctx, dateX, currentY + 16, dateW, 24, 8);
    ctx.fillStyle = p.isDark ? "rgba(255,255,255,0.06)" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = p.isDark ? "rgba(255,255,255,0.12)" : "#e2e8f0";
    ctx.stroke();
    ctx.fillStyle = p.textSecondary;
    ctx.fillText(dateRangeStr, dateX + 8, currentY + 32);

    ctx.fillStyle = p.titlePrimary;
    ctx.font = "800 17px Inter, system-ui, sans-serif";
    ctx.fillText(meta.title, padding + 18, currentY + 68);

    ctx.fillStyle = p.textSecondary;
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    const descLines = wrapText(ctx, meta.description, cardW - 36, 2);
    descLines.forEach((line, idx) => {
      ctx.fillText(line, padding + 18, currentY + 92 + idx * 17);
    });
  } else if (lessons.length === 0) {
    drawRoundedRect(ctx, padding, currentY, width - padding * 2, 70, 14);
    ctx.fillStyle = p.cardBg;
    ctx.fill();
    ctx.strokeStyle = p.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.titlePrimary;
    ctx.font = "700 15px Inter, system-ui, sans-serif";
    ctx.fillText("🎉 Пар немає", padding + 20, currentY + 30);

    ctx.fillStyle = p.textSecondary;
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillText("Розклад на цей день вільний", padding + 20, currentY + 50);
  } else {
    for (const lesson of lessons) {
      const cardW = width - padding * 2;
      const item = formatLessonDetails(lesson, scheduleMode);

      drawRoundedRect(ctx, padding, currentY, cardW, cardHeight, 14);
      ctx.fillStyle = item.isCancelled
        ? p.cancelledBg
        : item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.12)" : "#fff1f2"
          : p.isDark ? "rgba(14, 165, 233, 0.12)" : "#f0f9ff"
        : item.isReplacement
        ? p.repBg
        : p.cardBg;
      ctx.fill();

      ctx.strokeStyle = item.isCancelled
        ? p.cancelledBorder
        : item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.45)" : "#fecdd3"
          : p.isDark ? "rgba(14, 165, 233, 0.45)" : "#bae6fd"
        : item.isReplacement
        ? p.repBorder
        : p.cardBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ліва акцентна смужка
      const stripColor = item.isCancelled
        ? p.cancelledText
        : item.eventBadge
        ? item.eventBadge.bg || p.accent
        : item.isReplacement
        ? "#f59e0b"
        : p.accent;
      drawLeftAccentStrip(ctx, padding, currentY, cardHeight, 14, stripColor);

      // Ліва колонка: номер пари + час
      ctx.fillStyle = item.isCancelled
        ? p.cancelledText
        : item.eventBadge
        ? item.eventBadge.bg === "#e11d48" ? "#fb7185" : p.accent
        : item.isReplacement
        ? p.repText
        : p.accent;
      ctx.font = "800 20px Inter, system-ui, sans-serif";
      ctx.fillText(String(item.lessonNumber), padding + 16, currentY + 33);

      ctx.fillStyle = item.isCancelled ? p.cancelledText : p.textSecondary;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillText(item.startTime || "", padding + 16, currentY + 52);
      ctx.fillText(item.endTime || "", padding + 16, currentY + 67);

      // Вертикальна лінія після часу
      ctx.strokeStyle = p.timeLine;
      ctx.beginPath();
      ctx.moveTo(padding + 64, currentY + 12);
      ctx.lineTo(padding + 64, currentY + cardHeight - 12);
      ctx.stroke();

      // Бейдж події / заміни / скасування зверху справа
      let topRightEdge = width - padding - 12;
      if (item.isCancelled) {
        const w = drawStatusPill(
          ctx,
          0,
          currentY + 12,
          "СКАСОВАНО",
          p.cancelledBg,
          p.cancelledBorder,
          p.cancelledText
        );
        const rx = topRightEdge - w;
        drawStatusPill(
          ctx,
          rx,
          currentY + 12,
          "СКАСОВАНО",
          p.cancelledBg,
          p.cancelledBorder,
          p.cancelledText
        );
        topRightEdge = rx - 6;
      } else if (item.eventBadge) {
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const evW = ctx.measureText(item.eventBadge.label).width + 12;
        const evX = topRightEdge - evW;
        drawRoundedRect(ctx, evX, currentY + 12, evW, 20, 6);
        ctx.fillStyle = item.eventBadge.bg || "#0284c7";
        ctx.fill();
        ctx.fillStyle = item.eventBadge.text || "#ffffff";
        ctx.fillText(item.eventBadge.label, evX + 6, currentY + 25.5);
        topRightEdge = evX - 6;
      } else if (item.isReplacement) {
        const repText = "⚡ ЗАМІНА";
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const repW = ctx.measureText(repText).width + 12;
        const repX = topRightEdge - repW;
        drawRoundedRect(ctx, repX, currentY + 12, repW, 20, 6);
        ctx.fillStyle = p.isDark ? "#f59e0b" : "#fef3c7";
        ctx.fill();
        ctx.strokeStyle = p.isDark ? "#f59e0b" : "#fcd34d";
        ctx.stroke();
        ctx.fillStyle = p.isDark ? "#09090b" : "#b45309";
        ctx.fillText(repText, repX + 6, currentY + 25.5);
        topRightEdge = repX - 6;
      }

      // Назва предмета з динамічним розрахунком ширини
      const textX = padding + 76;
      const maxSubjectWidth = Math.max(120, topRightEdge - textX - 4);

      ctx.fillStyle = item.isCancelled ? p.cancelledText : p.titlePrimary;
      ctx.font = "700 14px Inter, system-ui, sans-serif";
      const subjectLines = wrapText(ctx, item.subjectName, maxSubjectWidth, 2);
      subjectLines.forEach((line, i) => {
        const ly = currentY + 27 + i * 17;
        ctx.fillText(line, textX, ly);
        if (item.isCancelled) {
          const lineW = ctx.measureText(line).width;
          ctx.strokeStyle = p.cancelledText;
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(textX, ly - 4);
          ctx.lineTo(textX + lineW, ly - 4);
          ctx.stroke();
        }
      });

      // Аудиторія і Meet знизу справа
      let rightX = width - padding - 12;
      const bottomY = currentY + cardHeight - 31;

      if (!item.isCancelled && item.meetings.length > 0) {
        const plat = item.meetings[0].platform;
        const meetLabel = plat === "zoom" ? "Zoom ↗" : plat === "meet" ? "Meet ↗" : "Онлайн ↗";
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        const meetW = ctx.measureText(meetLabel).width + 14;
        const meetX = rightX - meetW;
        drawRoundedRect(ctx, meetX, bottomY, meetW, 20, 6);

        if (plat === "zoom") {
          ctx.fillStyle = p.isDark ? "rgba(14, 165, 233, 0.2)" : "#e0f2fe";
          ctx.fill();
          ctx.strokeStyle = p.isDark ? "rgba(14, 165, 233, 0.5)" : "#7dd3fc";
          ctx.stroke();
          ctx.fillStyle = p.isDark ? "#38bdf8" : "#0369a1";
        } else if (plat === "meet") {
          ctx.fillStyle = p.isDark ? "rgba(16, 185, 129, 0.2)" : "#dcfce7";
          ctx.fill();
          ctx.strokeStyle = p.isDark ? "rgba(16, 185, 129, 0.5)" : "#86efac";
          ctx.stroke();
          ctx.fillStyle = p.isDark ? "#34d399" : "#15803d";
        } else {
          ctx.fillStyle = p.isDark ? "rgba(99, 102, 241, 0.2)" : "#e0e7ff";
          ctx.fill();
          ctx.strokeStyle = p.isDark ? "rgba(99, 102, 241, 0.5)" : "#a5b4fc";
          ctx.stroke();
          ctx.fillStyle = p.isDark ? "#818cf8" : "#4338ca";
        }
        ctx.fillText(meetLabel, meetX + 7, bottomY + 14);
        rightX = meetX - 6;
      }

      if (!item.isCancelled && item.roomText) {
        const roomStr = item.roomText;
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        const roomW = ctx.measureText(roomStr).width + 14;
        const roomX = rightX - roomW;
        drawRoundedRect(ctx, roomX, bottomY, roomW, 20, 6);
        ctx.fillStyle = p.roomChipBg;
        ctx.fill();
        ctx.strokeStyle = p.roomChipBorder;
        ctx.stroke();
        ctx.fillStyle = p.roomChipText;
        ctx.fillText(roomStr, roomX + 7, bottomY + 14);
        rightX = roomX - 6;
      }

      if (item.secondary) {
        const maxSecW = Math.max(60, rightX - textX - 4);
        ctx.fillStyle = item.isCancelled ? p.cancelledText : p.textSecondary;
        ctx.font = "500 11.5px Inter, system-ui, sans-serif";
        ctx.fillText(truncateLine(ctx, item.secondary, maxSecW), textX, currentY + cardHeight - 15);
      }

      currentY += cardHeight + cardGap;
    }
  }

  // 4. Футер з часом генерації
  const nowHm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  ctx.fillStyle = p.footerText;
  ctx.font = "500 11px Inter, system-ui, sans-serif";
  ctx.fillText(`ДФКР · Розклад · станом на ${nowHm}`, padding, height - 16);
  const brandRight = "rozklad-dfkr.pp.ua";
  const brandW = ctx.measureText(brandRight).width;
  ctx.fillText(brandRight, width - padding - brandW, height - 16);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Не вдалося згенерувати зображення"));
    }, "image/png");
  });
}

export async function shareScheduleAsImage(
  schedule: ScheduleResponse,
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekNumber?: number | null,
  theme?: "light" | "dark"
): Promise<"copied" | "shared" | "downloaded"> {
  const blob = await generateScheduleCardBlob(schedule, scheduleMode, ownerLabel, weekNumber, theme);
  return deliverImageBlob(blob, `schedule-${schedule.date}.png`, ownerLabel);
}

export async function generateWeekScheduleCardBlob(
  week: ScheduleResponse[],
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekRangeLabel?: string,
  weekNumber?: number | null,
  theme?: "light" | "dark"
): Promise<Blob> {
  const effectiveTheme = resolveTheme(theme);
  const p = getThemePalette(effectiveTheme);

  const scale = 2;
  const colCount = 5;
  const padding = 28;
  const colGap = 14;
  const colW = 296;
  const width = padding * 2 + colCount * colW + (colCount - 1) * colGap; // 1592px

  const headerH = 104;
  const dayHeaderH = 62;
  const rowGap = 10;
  const cardHeight = 94;
  const footerH = 44;

  let maxSlot = 4;
  for (const day of week) {
    for (const l of day.lessons) {
      if (l.lesson_number > maxSlot) maxSlot = l.lesson_number;
    }
  }

  const gridTopY = headerH + dayHeaderH + 14;
  const gridHeight = maxSlot * cardHeight + (maxSlot - 1) * rowGap;
  const height = gridTopY + gridHeight + footerH;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

  // 1. Фон полотна
  ctx.fillStyle = p.canvasBg;
  ctx.fillRect(0, 0, width, height);

  // 2. Шапка тижня
  ctx.fillStyle = p.accent;
  ctx.font = "700 13px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText((ownerLabel || "РОЗКЛАД ЗАНЯТЬ НА ТИЖДЕНЬ").toUpperCase(), padding, 34);

  const firstDay = week[0];
  const computedRange =
    weekRangeLabel ||
    (firstDay
      ? formatFullWeekRange(calendarDateIsoToUtcDate(firstDay.date))
      : "Розклад на тиждень");

  ctx.fillStyle = p.titlePrimary;
  ctx.font = "800 24px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(computedRange, padding, 66);

  const weekTypeVal = firstDay?.week_type;
  const weekTypeUk =
    weekTypeVal === "numerator"
      ? "чисельник"
      : weekTypeVal === "denominator"
      ? "знаменник"
      : "";

  let fullWeekBadge = "";
  if (weekNumber && weekTypeUk) {
    fullWeekBadge = `${weekNumber} тиждень · ${weekTypeUk}`;
  } else if (weekNumber) {
    fullWeekBadge = `${weekNumber} тиждень`;
  } else if (weekTypeUk) {
    fullWeekBadge = weekTypeUk.charAt(0).toUpperCase() + weekTypeUk.slice(1);
  }

  let rightHeaderX = width - padding;

  if (fullWeekBadge) {
    ctx.font = "600 13px Inter, system-ui, -apple-system, sans-serif";
    const badgeW = ctx.measureText(fullWeekBadge).width + 24;
    rightHeaderX -= badgeW;
    drawRoundedRect(ctx, rightHeaderX, 42, badgeW, 30, 15);
    ctx.fillStyle = p.headerBadgeBg;
    ctx.fill();
    ctx.strokeStyle = p.headerBadgeBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.headerBadgeText;
    ctx.fillText(fullWeekBadge, rightHeaderX + 12, 62);
  }

  const activeWeekPeriod = week.find((d) => d.period_info)?.period_info;
  if (activeWeekPeriod) {
    const meta = getPeriodMeta(activeWeekPeriod);
    const pColor = getPeriodColor(activeWeekPeriod.period_type, p.isDark);
    const periodLabel = `${meta.icon} ${meta.title}`;
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    const periodW = ctx.measureText(periodLabel).width + 22;
    rightHeaderX -= periodW + 10;
    drawRoundedRect(ctx, rightHeaderX, 42, periodW, 30, 15);
    ctx.fillStyle = pColor.badgeBg;
    ctx.fill();
    ctx.strokeStyle = pColor.badgeBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = pColor.text;
    ctx.fillText(periodLabel, rightHeaderX + 11, 61.5);
  }

  ctx.strokeStyle = p.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, 88);
  ctx.lineTo(width - padding, 88);
  ctx.stroke();

  // 3. Колонки днів (Понеділок – П'ятниця)
  const daysToRender = week.slice(0, 5);

  daysToRender.forEach((daySchedule, colIdx) => {
    const colX = padding + colIdx * (colW + colGap);
    const dayHeaderY = headerH;
    const isPeriodDay = Boolean(daySchedule.period_info && daySchedule.lessons.length === 0);

    drawRoundedRect(ctx, colX, dayHeaderY, colW, dayHeaderH, 14);
    ctx.fillStyle = p.cardBg;
    ctx.fill();
    ctx.strokeStyle = p.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const dateObj = calendarDateIsoToUtcDate(daySchedule.date);
    const weekdayRaw = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv",
      weekday: "long",
    }).format(dateObj);
    const weekdayTitle = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
    const shortDate = new Intl.DateTimeFormat("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "numeric",
      month: "short",
    }).format(dateObj);

    ctx.fillStyle = p.titlePrimary;
    ctx.font = "700 16px Inter, system-ui, sans-serif";
    ctx.fillText(weekdayTitle, colX + 14, dayHeaderY + 26);

    let headerRightOffset = 14;
    if (daySchedule.is_shortened_day) {
      const shortText = "⏱ 50 хв";
      ctx.font = "700 10.5px Inter, system-ui, sans-serif";
      const shortW = ctx.measureText(shortText).width + 10;
      const shortX = colX + colW - headerRightOffset - shortW;
      drawRoundedRect(ctx, shortX, dayHeaderY + 32, shortW, 18, 5);
      ctx.fillStyle = p.shortenedBadgeBg;
      ctx.fill();
      ctx.strokeStyle = p.shortenedBadgeBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = p.shortenedBadgeText;
      ctx.fillText(shortText, shortX + 5, dayHeaderY + 44.5);
      headerRightOffset += shortW + 6;
    }

    if (daySchedule.learning_mode_override) {
      const ovMode =
        daySchedule.learning_mode_override.mode === "offline" ? "Очно" : "Дистанційно";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      const ovW = ctx.measureText(ovMode).width + 12;
      const ovX = colX + colW - headerRightOffset - ovW;
      drawRoundedRect(ctx, ovX, dayHeaderY + 32, ovW, 18, 5);
      ctx.fillStyle =
        daySchedule.learning_mode_override.mode === "offline"
          ? p.overrideOfflineBg
          : p.overrideOnlineBg;
      ctx.fill();
      ctx.fillStyle =
        daySchedule.learning_mode_override.mode === "offline"
          ? p.overrideOfflineText
          : p.overrideOnlineText;
      ctx.fillText(ovMode, ovX + 6, dayHeaderY + 44.5);
      headerRightOffset += ovW + 6;
    }

    const maxShortDateW = Math.max(50, colW - 14 - headerRightOffset - 6);
    ctx.fillStyle = p.textSecondary;
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillText(truncateLine(ctx, shortDate, maxShortDateW), colX + 14, dayHeaderY + 47);

    if (isPeriodDay && daySchedule.period_info) {
      const meta = getPeriodMeta(daySchedule.period_info);
      const pColor = getPeriodColor(daySchedule.period_info.period_type, p.isDark);
      const periodBadge = `${meta.icon} ${meta.shortLabel}`;
      ctx.font = "700 11px Inter, system-ui, sans-serif";
      const pW = ctx.measureText(periodBadge).width + 14;
      const pX = colX + colW - 14 - pW;
      drawRoundedRect(ctx, pX, dayHeaderY + 12, pW, 20, 10);
      ctx.fillStyle = pColor.badgeBg;
      ctx.fill();
      ctx.strokeStyle = pColor.badgeBorder;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = pColor.text;
      ctx.fillText(periodBadge, pX + 7, dayHeaderY + 25.5);
    } else {
      const activeCount = daySchedule.lessons.filter((l) => !l.is_cancelled).length;
      const countLabel =
        activeCount === 0
          ? "пар немає"
          : `${activeCount} ${activeCount === 1 ? "пара" : activeCount < 5 ? "пари" : "пар"}`;
      ctx.font = "600 11.5px Inter, system-ui, sans-serif";
      const countW = ctx.measureText(countLabel).width;
      ctx.fillStyle = activeCount > 0 ? p.accent : p.textMuted;
      ctx.fillText(countLabel, colX + colW - 14 - countW, dayHeaderY + 25);
    }

    if (isPeriodDay && daySchedule.period_info) {
      const meta = getPeriodMeta(daySchedule.period_info);
      const dateRangeStr = formatDateRange(
        daySchedule.period_info.start_date,
        daySchedule.period_info.end_date
      );
      const pColor = getPeriodColor(daySchedule.period_info.period_type, p.isDark);

      drawRoundedRect(ctx, colX, gridTopY, colW, gridHeight, 16);
      ctx.fillStyle = pColor.bg;
      ctx.fill();
      ctx.strokeStyle = pColor.border;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const centerY = gridTopY + gridHeight / 2;

      ctx.font = "32px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(meta.icon, colX + colW / 2, centerY - 42);

      ctx.font = "700 12px Inter, system-ui, sans-serif";
      const badgeW = ctx.measureText(meta.shortLabel).width + 20;
      drawRoundedRect(ctx, colX + colW / 2 - badgeW / 2, centerY - 28, badgeW, 22, 11);
      ctx.fillStyle = pColor.badgeBg;
      ctx.fill();
      ctx.strokeStyle = pColor.badgeBorder;
      ctx.stroke();
      ctx.fillStyle = pColor.text;
      ctx.fillText(meta.shortLabel, colX + colW / 2, centerY - 13);

      ctx.fillStyle = p.titlePrimary;
      ctx.font = "800 14px Inter, system-ui, sans-serif";
      const titleLines = wrapText(ctx, meta.title, colW - 32, 2);
      titleLines.forEach((line, idx) => {
        ctx.fillText(line, colX + colW / 2, centerY + 16 + idx * 17);
      });

      ctx.fillStyle = p.textSecondary;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillText(dateRangeStr, colX + colW / 2, centerY + 24 + titleLines.length * 17);

      ctx.textAlign = "start";
      return;
    }

    for (let slotNum = 1; slotNum <= maxSlot; slotNum++) {
      const slotY = gridTopY + (slotNum - 1) * (cardHeight + rowGap);
      const slotLessons = daySchedule.lessons
        .filter((l) => l.lesson_number === slotNum)
        .sort((a, b) => Number(Boolean(a.is_cancelled)) - Number(Boolean(b.is_cancelled)) || a.id - b.id);

      if (slotLessons.length === 0) {
        drawRoundedRect(ctx, colX, slotY, colW, cardHeight, 14);
        ctx.fillStyle = p.slotEmptyBg;
        ctx.fill();
        ctx.strokeStyle = p.slotEmptyBorder;
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = p.slotEmptyText;
        ctx.font = "700 16px Inter, system-ui, sans-serif";
        ctx.fillText(String(slotNum), colX + 14, slotY + 28);

        ctx.font = "500 14px Inter, system-ui, sans-serif";
        ctx.fillText("—", colX + 54, slotY + 50);
        continue;
      }

      const lesson = slotLessons[0];
      const extraSplitCount = slotLessons.length - 1;
      const item = formatLessonDetails(lesson, scheduleMode);

      drawRoundedRect(ctx, colX, slotY, colW, cardHeight, 14);
      ctx.fillStyle = item.isCancelled
        ? p.cancelledBg
        : item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.12)" : "#fff1f2"
          : p.isDark ? "rgba(14, 165, 233, 0.12)" : "#f0f9ff"
        : item.isReplacement
        ? p.repBg
        : p.cardBg;
      ctx.fill();

      ctx.strokeStyle = item.isCancelled
        ? p.cancelledBorder
        : item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.45)" : "#fecdd3"
          : p.isDark ? "rgba(14, 165, 233, 0.45)" : "#bae6fd"
        : item.isReplacement
        ? p.repBorder
        : p.cardBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      const stripColor = item.isCancelled
        ? p.cancelledText
        : item.eventBadge
        ? item.eventBadge.bg || p.accent
        : item.isReplacement
        ? "#f59e0b"
        : p.accent;
      drawLeftAccentStrip(ctx, colX, slotY, cardHeight, 14, stripColor);

      ctx.fillStyle = item.isCancelled
        ? p.cancelledText
        : item.eventBadge
        ? item.eventBadge.bg === "#e11d48" ? "#fb7185" : p.accent
        : item.isReplacement
        ? p.repText
        : p.accent;
      ctx.font = "800 18px Inter, system-ui, sans-serif";
      ctx.fillText(String(item.lessonNumber), colX + 12, slotY + 29);

      ctx.fillStyle = item.isCancelled ? p.cancelledText : p.textSecondary;
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.fillText(item.startTime || "", colX + 12, slotY + 47);
      ctx.fillText(item.endTime || "", colX + 12, slotY + 61);

      ctx.strokeStyle = p.timeLine;
      ctx.beginPath();
      ctx.moveTo(colX + 48, slotY + 10);
      ctx.lineTo(colX + 48, slotY + cardHeight - 10);
      ctx.stroke();

      // Топ-справа бейджі (Скасовано / Подія / Заміна / Підгрупа / +N)
      let topRightX = colX + colW - 10;
      if (item.isCancelled) {
        ctx.font = "700 9px Inter, system-ui, sans-serif";
        const cText = "СКАСОВАНО";
        const cW = ctx.measureText(cText).width + 10;
        const cX = topRightX - cW;
        drawRoundedRect(ctx, cX, slotY + 10, cW, 18, 5);
        ctx.fillStyle = p.cancelledBg;
        ctx.fill();
        ctx.strokeStyle = p.cancelledBorder;
        ctx.stroke();
        ctx.fillStyle = p.cancelledText;
        ctx.fillText(cText, cX + 5, slotY + 22);
        topRightX = cX - 4;
      } else if (item.eventBadge) {
        ctx.font = "700 9px Inter, system-ui, sans-serif";
        const evW = ctx.measureText(item.eventBadge.label).width + 10;
        const evX = topRightX - evW;
        drawRoundedRect(ctx, evX, slotY + 10, evW, 18, 5);
        ctx.fillStyle = item.eventBadge.bg || "#0284c7";
        ctx.fill();
        ctx.fillStyle = item.eventBadge.text || "#ffffff";
        ctx.fillText(item.eventBadge.label, evX + 5, slotY + 22);
        topRightX = evX - 4;
      } else if (item.isReplacement) {
        const repText = "⚡ ЗАМІНА";
        ctx.font = "700 9px Inter, system-ui, sans-serif";
        const repW = ctx.measureText(repText).width + 10;
        const repX = topRightX - repW;
        drawRoundedRect(ctx, repX, slotY + 10, repW, 18, 5);
        ctx.fillStyle = p.isDark ? "#f59e0b" : "#fef3c7";
        ctx.fill();
        ctx.strokeStyle = p.isDark ? "#f59e0b" : "#fcd34d";
        ctx.stroke();
        ctx.fillStyle = p.isDark ? "#09090b" : "#b45309";
        ctx.fillText(repText, repX + 5, slotY + 22);
        topRightX = repX - 4;
      }

      if (extraSplitCount > 0) {
        const splitText = `+${extraSplitCount}`;
        ctx.font = "700 9px Inter, system-ui, sans-serif";
        const spW = ctx.measureText(splitText).width + 8;
        const spX = topRightX - spW;
        drawRoundedRect(ctx, spX, slotY + 10, spW, 18, 5);
        ctx.fillStyle = p.headerBadgeBg;
        ctx.fill();
        ctx.strokeStyle = p.headerBadgeBorder;
        ctx.stroke();
        ctx.fillStyle = p.headerBadgeText;
        ctx.fillText(splitText, spX + 4, slotY + 22);
        topRightX = spX - 4;
      }

      const textX = colX + 58;
      const maxSubjectWidth = Math.max(80, topRightX - textX - 4);

      ctx.fillStyle = item.isCancelled ? p.cancelledText : p.titlePrimary;
      ctx.font = "700 12.5px Inter, system-ui, sans-serif";
      const subjectLines = wrapText(ctx, item.subjectName, maxSubjectWidth, 2);
      subjectLines.forEach((line, i) => {
        const ly = slotY + 24 + i * 15;
        ctx.fillText(line, textX, ly);
        if (item.isCancelled) {
          const lineW = ctx.measureText(line).width;
          ctx.strokeStyle = p.cancelledText;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(textX, ly - 3.5);
          ctx.lineTo(textX + lineW, ly - 3.5);
          ctx.stroke();
        }
      });

      let rightX = colX + colW - 10;
      const bottomY = slotY + cardHeight - 28;

      if (!item.isCancelled && item.meetings.length > 0) {
        const plat = item.meetings[0].platform;
        const meetLabel = plat === "zoom" ? "Zoom ↗" : plat === "meet" ? "Meet ↗" : "Онлайн ↗";
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        const meetW = ctx.measureText(meetLabel).width + 12;
        const meetX = rightX - meetW;
        drawRoundedRect(ctx, meetX, bottomY, meetW, 18, 5);

        if (plat === "zoom") {
          ctx.fillStyle = p.isDark ? "rgba(14, 165, 233, 0.2)" : "#e0f2fe";
          ctx.fill();
          ctx.strokeStyle = p.isDark ? "rgba(14, 165, 233, 0.5)" : "#7dd3fc";
          ctx.stroke();
          ctx.fillStyle = p.isDark ? "#38bdf8" : "#0369a1";
        } else if (plat === "meet") {
          ctx.fillStyle = p.isDark ? "rgba(16, 185, 129, 0.2)" : "#dcfce7";
          ctx.fill();
          ctx.strokeStyle = p.isDark ? "rgba(16, 185, 129, 0.5)" : "#86efac";
          ctx.stroke();
          ctx.fillStyle = p.isDark ? "#34d399" : "#15803d";
        } else {
          ctx.fillStyle = p.isDark ? "rgba(99, 102, 241, 0.2)" : "#e0e7ff";
          ctx.fill();
          ctx.strokeStyle = p.isDark ? "rgba(99, 102, 241, 0.5)" : "#a5b4fc";
          ctx.stroke();
          ctx.fillStyle = p.isDark ? "#818cf8" : "#4338ca";
        }
        ctx.fillText(meetLabel, meetX + 6, bottomY + 12.5);
        rightX = meetX - 5;
      }

      if (!item.isCancelled && item.roomText) {
        const roomStr = item.roomText;
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        const roomW = ctx.measureText(roomStr).width + 12;
        const roomX = rightX - roomW;
        drawRoundedRect(ctx, roomX, bottomY, roomW, 18, 5);
        ctx.fillStyle = p.roomChipBg;
        ctx.fill();
        ctx.strokeStyle = p.roomChipBorder;
        ctx.stroke();
        ctx.fillStyle = p.roomChipText;
        ctx.fillText(roomStr, roomX + 6, bottomY + 12.5);
        rightX = roomX - 5;
      }

      if (item.secondary) {
        const maxSecW = Math.max(40, rightX - textX - 4);
        ctx.fillStyle = item.isCancelled ? p.cancelledText : p.textSecondary;
        ctx.font = "500 10.5px Inter, system-ui, sans-serif";
        ctx.fillText(truncateLine(ctx, item.secondary, maxSecW), textX, slotY + cardHeight - 15);
      }
    }
  });

  // 5. Футер
  const nowHm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  ctx.fillStyle = p.footerText;
  ctx.font = "500 11px Inter, system-ui, sans-serif";
  ctx.fillText(`ДФКР · Розклад · станом на ${nowHm}`, padding, height - 16);
  const brandRight = "rozklad-dfkr.pp.ua";
  const brandW = ctx.measureText(brandRight).width;
  ctx.fillText(brandRight, width - padding - brandW, height - 16);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Не вдалося згенерувати зображення тижня"));
    }, "image/png");
  });
}

export async function shareWeekScheduleAsImage(
  week: ScheduleResponse[],
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekRangeLabel?: string,
  weekNumber?: number | null,
  theme?: "light" | "dark"
): Promise<"copied" | "shared" | "downloaded"> {
  const blob = await generateWeekScheduleCardBlob(
    week,
    scheduleMode,
    ownerLabel,
    weekRangeLabel,
    weekNumber,
    theme
  );
  const startIso = week[0]?.date || "week";
  return deliverImageBlob(blob, `schedule-week-${startIso}.png`, ownerLabel);
}

async function deliverImageBlob(
  blob: Blob,
  fileName: string,
  ownerLabel?: string
): Promise<"copied" | "shared" | "downloaded"> {
  const file = new File([blob], fileName, { type: "image/png" });

  if (
    typeof navigator !== "undefined" &&
    window.innerWidth < 768 &&
    navigator.canShare &&
    navigator.canShare({ files: [file] })
  ) {
    await navigator.share({
      files: [file],
      title: ownerLabel || "Розклад занять",
    });
    return "shared";
  }

  if (typeof navigator !== "undefined" && navigator.clipboard && "ClipboardItem" in window) {
    try {
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      return "copied";
    } catch {
      // Fallback to download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return "downloaded";
}
