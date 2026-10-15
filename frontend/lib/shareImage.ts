import { ScheduleResponse } from "./api";
import { formatRoom, formatTeachers } from "./format";

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
  ownerLabel?: string
): Promise<Blob> {
  const scale = 2; // Retina 2x (1080px ширина)
  const width = 540;
  const padding = 28;
  const cardGap = 12;
  const cardHeight = 92;

  const lessons = schedule.lessons;
  const contentHeight =
    lessons.length > 0 ? lessons.length * cardHeight + (lessons.length - 1) * cardGap : 80;
  const height = 132 + contentHeight + 48;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(scale, scale);

  // 1. Фон полотна
  ctx.fillStyle = "#0b1120";
  ctx.fillRect(0, 0, width, height);

  // Делікатне неонове світіння зверху
  const glow = ctx.createRadialGradient(width * 0.8, 0, 10, width * 0.8, 0, 260);
  glow.addColorStop(0, "rgba(56, 189, 248, 0.16)");
  glow.addColorStop(1, "rgba(56, 189, 248, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  // 2. Шапка картки (Дата + Група/Викладач + Чисельник/Знаменник)
  const dateObj = new Date(`${schedule.date}T12:00:00`);
  const dateFormatted = new Intl.DateTimeFormat("uk-UA", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(dateObj);
  const titleDate = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 12px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText((ownerLabel || "РОЗКЛАД ЗАНЯТЬ").toUpperCase(), padding, 38);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "800 24px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText(titleDate, padding, 68);

  const weekLabel =
    schedule.week_type === "numerator"
      ? "Чисельник"
      : schedule.week_type === "denominator"
        ? "Знаменник"
        : "";

  if (weekLabel) {
    ctx.font = "600 12px Inter, system-ui, -apple-system, sans-serif";
    const badgeW = ctx.measureText(weekLabel).width + 24;
    const badgeX = width - padding - badgeW;
    drawRoundedRect(ctx, badgeX, 46, badgeW, 28, 14);
    ctx.fillStyle = "rgba(56, 189, 248, 0.12)";
    ctx.fill();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#38bdf8";
    ctx.fillText(weekLabel, badgeX + 12, 64);
  }

  // Розділювач шапки
  ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, 92);
  ctx.lineTo(width - padding, 92);
  ctx.stroke();

  // 3. Список пар
  let currentY = 110;

  if (lessons.length === 0) {
    drawRoundedRect(ctx, padding, currentY, width - padding * 2, 70, 14);
    ctx.fillStyle = "rgba(30, 41, 59, 0.5)";
    ctx.fill();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 15px Inter, system-ui, sans-serif";
    ctx.fillText("🎉 На цей день пар немає", padding + 20, currentY + 40);
  } else {
    for (const lesson of lessons) {
      const cardW = width - padding * 2;
      drawRoundedRect(ctx, padding, currentY, cardW, cardHeight, 14);
      ctx.fillStyle = lesson.event_type
        ? (lesson.event_type === "exam" ? "rgba(225, 29, 72, 0.09)" : "rgba(14, 165, 233, 0.09)")
        : lesson.is_replacement
          ? "rgba(245, 158, 11, 0.07)"
          : "rgba(30, 41, 59, 0.65)";
      ctx.fill();

      ctx.strokeStyle = lesson.event_type
        ? (lesson.event_type === "exam" ? "rgba(225, 29, 72, 0.45)" : "rgba(14, 165, 233, 0.45)")
        : lesson.is_replacement
          ? "rgba(245, 158, 11, 0.45)"
          : "rgba(148, 163, 184, 0.16)";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ліва колонка: номер пари + час
      const [startT, endT] = lesson.time.split("-");
      ctx.fillStyle = lesson.event_type
        ? (lesson.event_type === "exam" ? "#fb7185" : "#38bdf8")
        : lesson.is_replacement
          ? "#fbbf24"
          : "#38bdf8";
      ctx.font = "800 22px Inter, system-ui, sans-serif";
      ctx.fillText(String(lesson.lesson_number), padding + 18, currentY + 34);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 11px Inter, system-ui, sans-serif";
      ctx.fillText(startT || "", padding + 18, currentY + 54);
      ctx.fillText(endT || "", padding + 18, currentY + 69);

      // Вертикальна лінія після часу
      ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
      ctx.beginPath();
      ctx.moveTo(padding + 68, currentY + 14);
      ctx.lineTo(padding + 68, currentY + cardHeight - 14);
      ctx.stroke();

      // Права частина: Предмет, викладач, кабінет
      const textX = padding + 82;
      const maxSubjectWidth = cardW - 175;

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 15px Inter, system-ui, sans-serif";
      const subjectDisplay = lesson.event_title && lesson.event_title !== lesson.subject_name
        ? `${lesson.subject_name} (${lesson.event_title})`
        : lesson.subject_name;
      const subjectLines = wrapText(ctx, subjectDisplay, maxSubjectWidth);
      subjectLines.forEach((line, i) => {
        ctx.fillText(line, textX, currentY + 28 + i * 18);
      });

      const secondary =
        scheduleMode === "teacher" && lesson.group_name
          ? `Група ${lesson.group_name}`
          : lesson.teacher_name
            ? formatTeachers(lesson.teacher_name)
            : "";

      if (secondary) {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "500 12px Inter, system-ui, sans-serif";
        ctx.fillText(secondary, textX, currentY + 72);
      }

      // Бейдж події / заміни
      if (lesson.event_type) {
        let evLabel = "📌 ПОДІЯ";
        let evBg = "#0284c7";
        if (lesson.event_type === "exam") { evLabel = "📝 ЕКЗАМЕН"; evBg = "#e11d48"; }
        else if (lesson.event_type === "consultation") { evLabel = "💬 КОНСУЛЬТАЦІЯ"; evBg = "#d97706"; }
        else if (lesson.event_type === "credit") { evLabel = "✅ ЗАЛІК"; evBg = "#059669"; }
        else if (lesson.event_type === "defense") { evLabel = "🎓 ЗАХИСТ"; evBg = "#7c3aed"; }
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const evW = ctx.measureText(evLabel).width + 14;
        const evX = width - padding - 14 - evW;
        drawRoundedRect(ctx, evX, currentY + 14, evW, 20, 6);
        ctx.fillStyle = evBg;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(evLabel, evX + 7, currentY + 27);
      } else if (lesson.is_replacement) {
        const repText = "⚡ ЗАМІНА";
        ctx.font = "700 10px Inter, system-ui, sans-serif";
        const repW = ctx.measureText(repText).width + 14;
        const repX = width - padding - 14 - repW;
        drawRoundedRect(ctx, repX, currentY + 14, repW, 20, 6);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.fillStyle = "#0b1120";
        ctx.fillText(repText, repX + 7, currentY + 27);
      }

      // Бейдж кабінету
      if (lesson.room) {
        const roomStr = `🚪 ${formatRoom(lesson.room)}`;
        ctx.font = "600 12px Inter, system-ui, sans-serif";
        const roomW = ctx.measureText(roomStr).width + 18;
        const roomX = width - padding - 14 - roomW;
        const roomY = currentY + cardHeight - 34;

        drawRoundedRect(ctx, roomX, roomY, roomW, 22, 6);
        ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
        ctx.stroke();

        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(roomStr, roomX + 9, roomY + 15);
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

  ctx.fillStyle = "#64748b";
  ctx.font = "500 11px Inter, system-ui, sans-serif";
  ctx.fillText(`Станом на ${nowHm}`, padding, height - 18);

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
  ownerLabel?: string
): Promise<"copied" | "shared" | "downloaded"> {
  const blob = await generateScheduleCardBlob(schedule, scheduleMode, ownerLabel);
  const fileName = `schedule-${schedule.date}.png`;
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
