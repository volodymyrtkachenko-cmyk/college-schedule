import { ScheduleResponse } from "./api";
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
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines = 2
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
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

function getThemePalette(theme: "light" | "dark"): ImageThemePalette {
  if (theme === "light") {
    return {
      isDark: false,
      canvasBg: "#f8fafc",
      cardBg: "#ffffff",
      cardBorder: "#e2e8f0",
      headerBorder: "#e2e8f0",
      titlePrimary: "#0f172a",
      textSecondary: "#475569",
      textMuted: "#64748b",
      accent: "#2563eb",
      headerBadgeBg: "#eff6ff",
      headerBadgeBorder: "#bfdbfe",
      headerBadgeText: "#1d4ed8",
      slotEmptyBg: "rgba(241, 245, 249, 0.7)",
      slotEmptyBorder: "rgba(226, 232, 240, 0.9)",
      slotEmptyText: "#94a3b8",
      roomChipBg: "#f1f5f9",
      roomChipBorder: "#e2e8f0",
      roomChipText: "#334155",
      repBg: "rgba(254, 243, 199, 0.6)",
      repBorder: "rgba(245, 158, 11, 0.5)",
      repText: "#b45309",
      timeLine: "#e2e8f0",
      footerText: "#94a3b8",
      shortenedBadgeBg: "rgba(254, 243, 199, 0.9)",
      shortenedBadgeBorder: "rgba(245, 158, 11, 0.4)",
      shortenedBadgeText: "#b45309",
      overrideOfflineBg: "rgba(37, 99, 235, 0.1)",
      overrideOfflineText: "#1d4ed8",
      overrideOnlineBg: "rgba(217, 119, 6, 0.1)",
      overrideOnlineText: "#b45309",
    };
  }

  return {
    isDark: true,
    canvasBg: "#09090b",
    cardBg: "#121215",
    cardBorder: "#27272a",
    headerBorder: "#27272a",
    titlePrimary: "#f8fafc",
    textSecondary: "#a1a1aa",
    textMuted: "#71717a",
    accent: "#38bdf8",
    headerBadgeBg: "#16161a",
    headerBadgeBorder: "#27272a",
    headerBadgeText: "#38bdf8",
    slotEmptyBg: "rgba(22, 22, 26, 0.4)",
    slotEmptyBorder: "rgba(39, 39, 42, 0.55)",
    slotEmptyText: "#52525b",
    roomChipBg: "#1e1e24",
    roomChipBorder: "#27272a",
    roomChipText: "#e4e4e7",
    repBg: "rgba(245, 158, 11, 0.1)",
    repBorder: "rgba(245, 158, 11, 0.45)",
    repText: "#fbbf24",
    timeLine: "#27272a",
    footerText: "#71717a",
    shortenedBadgeBg: "rgba(245, 158, 11, 0.15)",
    shortenedBadgeBorder: "rgba(245, 158, 11, 0.35)",
    shortenedBadgeText: "#fbbf24",
    overrideOfflineBg: "rgba(56, 189, 248, 0.14)",
    overrideOfflineText: "#38bdf8",
    overrideOnlineBg: "rgba(245, 158, 11, 0.14)",
    overrideOnlineText: "#fbbf24",
  };
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

export async function generateScheduleCardBlob(
  schedule: ScheduleResponse,
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekNumber?: number | null,
  theme?: "light" | "dark"
): Promise<Blob> {
  const effectiveTheme = resolveTheme(theme);
  const p = getThemePalette(effectiveTheme);

  const scale = 2; // Retina 2x (1080px ширина)
  const width = 540;
  const padding = 24;
  const cardGap = 10;
  const cardHeight = 82;

  const lessons = schedule.lessons;
  const isPeriodDay = Boolean(schedule.period_info && lessons.length === 0);
  const contentHeight = isPeriodDay
    ? 150
    : lessons.length > 0
    ? lessons.length * cardHeight + (lessons.length - 1) * cardGap
    : 84;
  const height = 120 + contentHeight + 44;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

  // 1. Фон полотна
  ctx.fillStyle = p.canvasBg;
  ctx.fillRect(0, 0, width, height);

  // 2. Шапка картки (Дата + Група/Викладач + Тиждень/Знаменник)
  const dateObj = new Date(`${schedule.date}T12:00:00`);
  const dateFormatted = new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateObj);
  const titleDate = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  ctx.fillStyle = p.accent;
  ctx.font = "700 12px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText((ownerLabel || "РОЗКЛАД ЗАНЯТЬ").toUpperCase(), padding, 34);

  ctx.fillStyle = p.titlePrimary;
  ctx.font = "800 22px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(titleDate, padding, 64);

  // Shortened day badge in Day header if applicable
  if (schedule.is_shortened_day) {
    const titleWidth = ctx.measureText(titleDate).width;
    const shortBadgeX = padding + titleWidth + 10;
    const shortText = "⏱ 50 хв";
    ctx.font = "700 11px Inter, system-ui, sans-serif";
    const shortW = ctx.measureText(shortText).width + 12;
    drawRoundedRect(ctx, shortBadgeX, 48, shortW, 20, 6);
    ctx.fillStyle = p.shortenedBadgeBg;
    ctx.fill();
    ctx.strokeStyle = p.shortenedBadgeBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = p.shortenedBadgeText;
    ctx.fillText(shortText, shortBadgeX + 6, 62);
  }

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

  if (fullWeekBadge) {
    ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
    const badgeW = ctx.measureText(fullWeekBadge).width + 20;
    const badgeX = width - padding - badgeW;
    drawRoundedRect(ctx, badgeX, 44, badgeW, 26, 13);
    ctx.fillStyle = p.headerBadgeBg;
    ctx.fill();
    ctx.strokeStyle = p.headerBadgeBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.headerBadgeText;
    ctx.fillText(fullWeekBadge, badgeX + 10, 61);
  }

  // Розділювач шапки
  ctx.strokeStyle = p.headerBorder;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, 86);
  ctx.lineTo(width - padding, 86);
  ctx.stroke();

  // 3. Список пар або спеціальний період
  let currentY = 100;

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

    // Top pill badge
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

    // Date range pill right
    const dateW = ctx.measureText(dateRangeStr).width + 16;
    const dateX = width - padding - 16 - dateW;
    drawRoundedRect(ctx, dateX, currentY + 16, dateW, 24, 8);
    ctx.fillStyle = p.isDark ? "rgba(255,255,255,0.06)" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = p.isDark ? "rgba(255,255,255,0.12)" : "#e2e8f0";
    ctx.stroke();
    ctx.fillStyle = p.textSecondary;
    ctx.fillText(dateRangeStr, dateX + 8, currentY + 32);

    // Title
    ctx.fillStyle = p.titlePrimary;
    ctx.font = "800 17px Inter, system-ui, sans-serif";
    ctx.fillText(meta.title, padding + 18, currentY + 68);

    // Description
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
      ctx.fillStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.12)" : "#fff1f2"
          : p.isDark ? "rgba(14, 165, 233, 0.12)" : "#f0f9ff"
        : item.isReplacement
        ? p.repBg
        : p.cardBg;
      ctx.fill();

      ctx.strokeStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.45)" : "#fecdd3"
          : p.isDark ? "rgba(14, 165, 233, 0.45)" : "#bae6fd"
        : item.isReplacement
        ? p.repBorder
        : p.cardBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ліва колонка: номер пари + час
      ctx.fillStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48" ? "#fb7185" : p.accent
        : item.isReplacement
        ? p.repText
        : p.accent;
      ctx.font = "800 20px Inter, system-ui, sans-serif";
      ctx.fillText(String(item.lessonNumber), padding + 16, currentY + 31);

      ctx.fillStyle = p.textSecondary;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillText(item.startTime || "", padding + 16, currentY + 50);
      ctx.fillText(item.endTime || "", padding + 16, currentY + 65);

      // Вертикальна лінія після часу
      ctx.strokeStyle = p.timeLine;
      ctx.beginPath();
      ctx.moveTo(padding + 64, currentY + 12);
      ctx.lineTo(padding + 64, currentY + cardHeight - 12);
      ctx.stroke();

      // Права частина: Предмет, викладач, кабінет
      const textX = padding + 76;
      const maxSubjectWidth = cardW - 170;

      ctx.fillStyle = p.titlePrimary;
      ctx.font = "700 14px Inter, system-ui, sans-serif";
      const subjectLines = wrapText(ctx, item.subjectName, maxSubjectWidth);
      subjectLines.forEach((line, i) => {
        ctx.fillText(line, textX, currentY + 25 + i * 17);
      });

      if (item.secondary) {
        ctx.fillStyle = p.textSecondary;
        ctx.font = "500 11.5px Inter, system-ui, sans-serif";
        ctx.fillText(item.secondary, textX, currentY + cardHeight - 14);
      }

      // Бейдж події / заміни зверху справа
      if (item.eventBadge) {
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const evW = ctx.measureText(item.eventBadge.label).width + 12;
        const evX = width - padding - 12 - evW;
        drawRoundedRect(ctx, evX, currentY + 12, evW, 20, 6);
        ctx.fillStyle = item.eventBadge.bg || (p.isDark ? "#0284c7" : "#0284c7");
        ctx.fill();
        ctx.fillStyle = item.eventBadge.text || "#ffffff";
        ctx.fillText(item.eventBadge.label, evX + 6, currentY + 25);
      } else if (item.isReplacement) {
        const repText = "⚡ ЗАМІНА";
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const repW = ctx.measureText(repText).width + 12;
        const repX = width - padding - 12 - repW;
        drawRoundedRect(ctx, repX, currentY + 12, repW, 20, 6);
        ctx.fillStyle = p.isDark ? "#f59e0b" : "#fef3c7";
        ctx.fill();
        ctx.strokeStyle = p.isDark ? "#f59e0b" : "#fcd34d";
        ctx.stroke();
        ctx.fillStyle = p.isDark ? "#09090b" : "#b45309";
        ctx.fillText(repText, repX + 6, currentY + 25);
      }

      // Аудиторія і Meet знизу справа
      let rightX = width - padding - 12;
      const bottomY = currentY + cardHeight - 31;

      if (item.meetings.length > 0) {
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

      if (item.roomText) {
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
  ctx.fillText(`Станом на ${nowHm} · college-schedule`, padding, height - 16);

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

  const scale = 2; // Retina 2x (3200px ширина)
  const colCount = 5;
  const padding = 28;
  const colGap = 14;
  const colW = 296;
  const width = padding * 2 + colCount * colW + (colCount - 1) * colGap; // 1592px

  const headerH = 104;
  const dayHeaderH = 62;
  const rowGap = 10;
  const cardHeight = 92;
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
      ? formatFullWeekRange(new Date(`${firstDay.date}T12:00:00`))
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

  // Active period badge in week header if any day is in a special period
  const activeWeekPeriod = week.find((d) => d.period_info)?.period_info;
  if (activeWeekPeriod) {
    const meta = getPeriodMeta(activeWeekPeriod);
    const pColor = getPeriodColor(activeWeekPeriod.period_type, p.isDark);
    const periodLabel = `${meta.icon} ${meta.title}`;
    ctx.font = "700 12px Inter, system-ui, sans-serif";
    const periodW = ctx.measureText(periodLabel).width + 22;
    rightHeaderX -= (periodW + 10);
    drawRoundedRect(ctx, rightHeaderX, 42, periodW, 30, 15);
    ctx.fillStyle = pColor.badgeBg;
    ctx.fill();
    ctx.strokeStyle = pColor.badgeBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = pColor.text;
    ctx.fillText(periodLabel, rightHeaderX + 11, 61.5);
  }

  // Розділювач шапки
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

    // Шапка дня
    drawRoundedRect(ctx, colX, dayHeaderY, colW, dayHeaderH, 14);
    ctx.fillStyle = p.cardBg;
    ctx.fill();
    ctx.strokeStyle = p.cardBorder;
    ctx.lineWidth = 1;
    ctx.stroke();

    const dateObj = new Date(`${daySchedule.date}T12:00:00`);
    const weekdayRaw = new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(dateObj);
    const weekdayTitle = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
    const shortDate = new Intl.DateTimeFormat("uk-UA", {
      day: "numeric",
      month: "short",
    }).format(dateObj);

    ctx.fillStyle = p.titlePrimary;
    ctx.font = "700 16px Inter, system-ui, sans-serif";
    ctx.fillText(weekdayTitle, colX + 14, dayHeaderY + 26);

    ctx.fillStyle = p.textSecondary;
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillText(shortDate, colX + 14, dayHeaderY + 47);

    // Shortened day badge in day header
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

    // Period badge or lessons count
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
      const lessonsCount = daySchedule.lessons.length;
      const countLabel =
        lessonsCount === 0
          ? "пар немає"
          : `${lessonsCount} ${lessonsCount === 1 ? "пара" : lessonsCount < 5 ? "пари" : "пар"}`;
      ctx.font = "600 11.5px Inter, system-ui, sans-serif";
      const countW = ctx.measureText(countLabel).width;
      ctx.fillStyle = lessonsCount > 0 ? p.accent : p.textMuted;
      ctx.fillText(countLabel, colX + colW - 14 - countW, dayHeaderY + 25);
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
    }

    // 4. Тіло колонки: якщо період без пар — малюємо повну картку періоду
    if (isPeriodDay && daySchedule.period_info) {
      const meta = getPeriodMeta(daySchedule.period_info);
      const dateRangeStr = formatDateRange(daySchedule.period_info.start_date, daySchedule.period_info.end_date);
      const pColor = getPeriodColor(daySchedule.period_info.period_type, p.isDark);

      drawRoundedRect(ctx, colX, gridTopY, colW, gridHeight, 16);
      ctx.fillStyle = pColor.bg;
      ctx.fill();
      ctx.strokeStyle = pColor.border;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const centerY = gridTopY + gridHeight / 2;

      // Icon (centered)
      ctx.font = "32px Inter, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(meta.icon, colX + colW / 2, centerY - 42);

      // Pill Badge (centered)
      ctx.font = "700 12px Inter, system-ui, sans-serif";
      const badgeW = ctx.measureText(meta.shortLabel).width + 20;
      drawRoundedRect(ctx, colX + colW / 2 - badgeW / 2, centerY - 28, badgeW, 22, 11);
      ctx.fillStyle = pColor.badgeBg;
      ctx.fill();
      ctx.strokeStyle = pColor.badgeBorder;
      ctx.stroke();
      ctx.fillStyle = pColor.text;
      ctx.fillText(meta.shortLabel, colX + colW / 2, centerY - 13);

      // Title (centered, wrapped)
      ctx.fillStyle = p.titlePrimary;
      ctx.font = "800 14px Inter, system-ui, sans-serif";
      const titleLines = wrapText(ctx, meta.title, colW - 32, 2);
      titleLines.forEach((line, idx) => {
        ctx.fillText(line, colX + colW / 2, centerY + 16 + idx * 17);
      });

      // Date Range (centered)
      ctx.fillStyle = p.textSecondary;
      ctx.font = "600 11px Inter, system-ui, sans-serif";
      ctx.fillText(dateRangeStr, colX + colW / 2, centerY + 24 + titleLines.length * 17);

      ctx.textAlign = "start"; // Reset alignment
      return;
    }

    // 5. Звичайні слоти пар 1..maxSlot
    for (let slotNum = 1; slotNum <= maxSlot; slotNum++) {
      const slotY = gridTopY + (slotNum - 1) * (cardHeight + rowGap);
      const slotLessons = daySchedule.lessons
        .filter((l) => l.lesson_number === slotNum)
        .sort((a, b) => a.id - b.id);

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
      const item = formatLessonDetails(lesson, scheduleMode);

      drawRoundedRect(ctx, colX, slotY, colW, cardHeight, 14);
      ctx.fillStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.12)" : "#fff1f2"
          : p.isDark ? "rgba(14, 165, 233, 0.12)" : "#f0f9ff"
        : item.isReplacement
        ? p.repBg
        : p.cardBg;
      ctx.fill();

      ctx.strokeStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? p.isDark ? "rgba(225, 29, 72, 0.45)" : "#fecdd3"
          : p.isDark ? "rgba(14, 165, 233, 0.45)" : "#bae6fd"
        : item.isReplacement
        ? p.repBorder
        : p.cardBorder;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ліва колонка: номер пари + час
      ctx.fillStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48" ? "#fb7185" : p.accent
        : item.isReplacement
        ? p.repText
        : p.accent;
      ctx.font = "800 18px Inter, system-ui, sans-serif";
      ctx.fillText(String(item.lessonNumber), colX + 12, slotY + 29);

      ctx.fillStyle = p.textSecondary;
      ctx.font = "600 10px Inter, system-ui, sans-serif";
      ctx.fillText(item.startTime || "", colX + 12, slotY + 47);
      ctx.fillText(item.endTime || "", colX + 12, slotY + 61);

      // Вертикальна лінія після часу
      ctx.strokeStyle = p.timeLine;
      ctx.beginPath();
      ctx.moveTo(colX + 48, slotY + 10);
      ctx.lineTo(colX + 48, slotY + cardHeight - 10);
      ctx.stroke();

      // Права частина: Предмет, викладач, кабінет / онлайн
      const textX = colX + 58;
      const hasTopBadge = Boolean(item.eventBadge || item.isReplacement);
      const maxSubjectWidth = colW - 68 - (hasTopBadge ? 56 : 0);

      ctx.fillStyle = p.titlePrimary;
      ctx.font = "700 12.5px Inter, system-ui, sans-serif";
      const subjectLines = wrapText(ctx, item.subjectName, maxSubjectWidth);
      subjectLines.forEach((line, i) => {
        ctx.fillText(line, textX, slotY + 23 + i * 15);
      });

      // Бейдж події / заміни зверху справа
      if (item.eventBadge) {
        ctx.font = "700 9px Inter, system-ui, sans-serif";
        const evW = ctx.measureText(item.eventBadge.label).width + 10;
        const evX = colX + colW - 10 - evW;
        drawRoundedRect(ctx, evX, slotY + 10, evW, 18, 5);
        ctx.fillStyle = item.eventBadge.bg || "#0284c7";
        ctx.fill();
        ctx.fillStyle = item.eventBadge.text || "#ffffff";
        ctx.fillText(item.eventBadge.label, evX + 5, slotY + 22);
      } else if (item.isReplacement) {
        const repText = "⚡ ЗАМІНА";
        ctx.font = "700 9px Inter, system-ui, sans-serif";
        const repW = ctx.measureText(repText).width + 10;
        const repX = colX + colW - 10 - repW;
        drawRoundedRect(ctx, repX, slotY + 10, repW, 18, 5);
        ctx.fillStyle = p.isDark ? "#f59e0b" : "#fef3c7";
        ctx.fill();
        ctx.strokeStyle = p.isDark ? "#f59e0b" : "#fcd34d";
        ctx.stroke();
        ctx.fillStyle = p.isDark ? "#09090b" : "#b45309";
        ctx.fillText(repText, repX + 5, slotY + 22);
      }

      // Аудиторія і Meet знизу справа
      let rightX = colX + colW - 10;
      const bottomY = slotY + cardHeight - 28;

      if (item.meetings.length > 0) {
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

      if (item.roomText) {
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

      // Викладач або група знизу зліва
      if (item.secondary) {
        const maxSecW = Math.max(40, rightX - textX - 4);
        ctx.fillStyle = p.textSecondary;
        ctx.font = "500 10.5px Inter, system-ui, sans-serif";
        let secText = item.secondary;
        while (secText.length > 3 && ctx.measureText(secText).width > maxSecW) {
          secText = secText.slice(0, -2).trimEnd() + "…";
        }
        ctx.fillText(secText, textX, slotY + cardHeight - 15);
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
  ctx.fillText(`Станом на ${nowHm} · college-schedule`, padding, height - 16);

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
