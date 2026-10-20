import { ScheduleResponse } from "./api";
import { formatLessonDetails } from "./format";

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
  maxWidth: number
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
  return lines.slice(0, 2); // Максимум 2 рядки на назву предмета
}

export async function generateScheduleCardBlob(
  schedule: ScheduleResponse,
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekNumber?: number | null
): Promise<Blob> {
  const scale = 2; // Retina 2x (1080px ширина)
  const width = 540;
  const padding = 24;
  const cardGap = 10;
  const cardHeight = 78;

  const lessons = schedule.lessons;
  const contentHeight =
    lessons.length > 0 ? lessons.length * cardHeight + (lessons.length - 1) * cardGap : 80;
  const height = 120 + contentHeight + 44;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

  // 1. Фон полотна (палітра як у застосунку --bg #09090b, без синього градієнта)
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, width, height);

  // 2. Шапка картки (Дата + Група/Викладач + Тиждень/Знаменник)
  const dateObj = new Date(`${schedule.date}T12:00:00`);
  const dateFormatted = new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateObj);
  const titleDate = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 12px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText((ownerLabel || "РОЗКЛАД ЗАНЯТЬ").toUpperCase(), padding, 34);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 22px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(titleDate, padding, 64);

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
    ctx.fillStyle = "#16161a";
    ctx.fill();
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#38bdf8";
    ctx.fillText(fullWeekBadge, badgeX + 10, 61);
  }

  // Розділювач шапки
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, 86);
  ctx.lineTo(width - padding, 86);
  ctx.stroke();

  // 3. Список пар
  let currentY = 100;

  if (lessons.length === 0) {
    drawRoundedRect(ctx, padding, currentY, width - padding * 2, 64, 12);
    ctx.fillStyle = "#16161a";
    ctx.fill();
    ctx.strokeStyle = "#27272a";
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 14px Inter, system-ui, sans-serif";
    ctx.fillText("🎉 На цей день пар немає", padding + 18, currentY + 36);
  } else {
    for (const lesson of lessons) {
      const cardW = width - padding * 2;
      const item = formatLessonDetails(lesson, scheduleMode);

      drawRoundedRect(ctx, padding, currentY, cardW, cardHeight, 12);
      ctx.fillStyle = item.eventBadge
        ? (item.eventBadge.bg === "#e11d48" ? "rgba(225, 29, 72, 0.09)" : "rgba(14, 165, 233, 0.09)")
        : item.isReplacement
        ? "rgba(245, 158, 11, 0.07)"
        : "#16161a";
      ctx.fill();

      ctx.strokeStyle = item.eventBadge
        ? (item.eventBadge.bg === "#e11d48" ? "rgba(225, 29, 72, 0.45)" : "rgba(14, 165, 233, 0.45)")
        : item.isReplacement
        ? "rgba(245, 158, 11, 0.45)"
        : "#27272a";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ліва колонка: номер пари + час
      ctx.fillStyle = item.eventBadge
        ? (item.eventBadge.bg === "#e11d48" ? "#fb7185" : "#38bdf8")
        : item.isReplacement
        ? "#fbbf24"
        : "#38bdf8";
      ctx.font = "800 20px Inter, system-ui, sans-serif";
      ctx.fillText(String(item.lessonNumber), padding + 16, currentY + 30);

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "500 11px Inter, system-ui, sans-serif";
      ctx.fillText(item.startTime || "", padding + 16, currentY + 48);
      ctx.fillText(item.endTime || "", padding + 16, currentY + 62);

      // Вертикальна лінія після часу
      ctx.strokeStyle = "#27272a";
      ctx.beginPath();
      ctx.moveTo(padding + 64, currentY + 10);
      ctx.lineTo(padding + 64, currentY + cardHeight - 10);
      ctx.stroke();

      // Права частина: Предмет, викладач, кабінет
      const textX = padding + 76;
      const maxSubjectWidth = cardW - 170;

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 14px Inter, system-ui, sans-serif";
      const subjectLines = wrapText(ctx, item.subjectName, maxSubjectWidth);
      subjectLines.forEach((line, i) => {
        ctx.fillText(line, textX, currentY + 24 + i * 16);
      });

      if (item.secondary) {
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "500 11px Inter, system-ui, sans-serif";
        ctx.fillText(item.secondary, textX, currentY + cardHeight - 14);
      }

      // Бейдж події / заміни зверху справа
      if (item.eventBadge) {
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const evW = ctx.measureText(item.eventBadge.label).width + 12;
        const evX = width - padding - 12 - evW;
        drawRoundedRect(ctx, evX, currentY + 12, evW, 20, 6);
        ctx.fillStyle = item.eventBadge.bg || "#0284c7";
        ctx.fill();
        ctx.fillStyle = item.eventBadge.text || "#ffffff";
        ctx.fillText(item.eventBadge.label, evX + 6, currentY + 25);
      } else if (item.isReplacement) {
        const repText = "⚡ ЗАМІНА";
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const repW = ctx.measureText(repText).width + 12;
        const repX = width - padding - 12 - repW;
        drawRoundedRect(ctx, repX, currentY + 12, repW, 20, 6);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.fillStyle = "#09090b";
        ctx.fillText(repText, repX + 6, currentY + 25);
      }

      // Аудиторія і Meet знизу справа (незалежно, поруч)
      let rightX = width - padding - 12;
      const bottomY = currentY + cardHeight - 30;

      if (item.meetings.length > 0) {
        const meetLabel = item.meetings[0].platform === "zoom" ? "Zoom ↗" : "Meet ↗";
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        const meetW = ctx.measureText(meetLabel).width + 14;
        const meetX = rightX - meetW;
        drawRoundedRect(ctx, meetX, bottomY, meetW, 20, 6);
        ctx.fillStyle = "rgba(14, 165, 233, 0.12)";
        ctx.fill();
        ctx.strokeStyle = "rgba(14, 165, 233, 0.4)";
        ctx.stroke();
        ctx.fillStyle = "#38bdf8";
        ctx.fillText(meetLabel, meetX + 7, bottomY + 14);
        rightX = meetX - 6;
      }

      if (item.roomText) {
        const roomStr = item.roomText;
        ctx.font = "600 11px Inter, system-ui, sans-serif";
        const roomW = ctx.measureText(roomStr).width + 14;
        const roomX = rightX - roomW;
        drawRoundedRect(ctx, roomX, bottomY, roomW, 20, 6);
        ctx.fillStyle = "#1e1e24";
        ctx.fill();
        ctx.strokeStyle = "#27272a";
        ctx.stroke();
        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(roomStr, roomX + 7, bottomY + 14);
      }

      currentY += cardHeight + cardGap;
    }
  }

  // 4. Футер з водяним знаком і часом генерації
  const nowHm = new Intl.DateTimeFormat("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());

  ctx.fillStyle = "#71717a";
  ctx.font = "500 11px Inter, system-ui, sans-serif";
  ctx.fillText(`Станом на ${nowHm}`, padding, height - 16);

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
  weekNumber?: number | null
): Promise<"copied" | "shared" | "downloaded"> {
  const blob = await generateScheduleCardBlob(schedule, scheduleMode, ownerLabel, weekNumber);
  return deliverImageBlob(blob, `schedule-${schedule.date}.png`, ownerLabel);
}


async function deliverImageBlob(
  blob: Blob,
  fileName: string,
  ownerLabel?: string
): Promise<"copied" | "shared" | "downloaded"> {
  const file = new File([blob], fileName, { type: "image/png" });

  // 1. На мобільних пристроях відкриваємо нативний Share Sheet з готовою картинкою
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

  // 2. На ПК копіюємо PNG-картинку прямо в буфер обміну (для вставки через Ctrl+V в Telegram)
  if (typeof navigator !== "undefined" && navigator.clipboard && "ClipboardItem" in window) {
    try {
      const item = new ClipboardItem({ "image/png": blob });
      await navigator.clipboard.write([item]);
      return "copied";
    } catch {
      // Якщо браузер заблокував буфер зображень — переходимо до скачування файлу
    }
  }

  // 3. Fallback: завантаження PNG-файлу
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

