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

export async function generateWeekScheduleCardBlob(
  week: ScheduleResponse[],
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekRangeLabel?: string,
  weekNumber?: number | null
): Promise<Blob> {
  const scale = 2; // Retina 2x (3200px ширина для чіткої 5-колонкової сітки)
  const colCount = 5;
  const padding = 28;
  const colGap = 14;
  const colW = 296;
  const width = padding * 2 + colCount * colW + (colCount - 1) * colGap; // 1592px логічна ширина

  const headerH = 104;
  const dayHeaderH = 58;
  const rowGap = 10;
  const cardHeight = 92;
  const footerH = 44;

  // Визначаємо максимальний номер пари за тиждень (мінімум 4 слоти)
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

  // 1. Фон полотна (#09090b — як у картинці дня)
  ctx.fillStyle = "#09090b";
  ctx.fillRect(0, 0, width, height);

  // 2. Шапка тижня (Група/Викладач + Діапазон дат + Бейдж тижня/чисельника)
  ctx.fillStyle = "#38bdf8";
  ctx.font = "700 13px Inter, system-ui, -apple-system, sans-serif";
  ctx.fillText((ownerLabel || "РОЗКЛАД ЗАНЯТЬ НА ТИЖДЕНЬ").toUpperCase(), padding, 34);

  const firstDay = week[0];
  const lastDay = week[week.length - 1];
  const computedRange =
    weekRangeLabel ||
    (firstDay && lastDay
      ? `${new Intl.DateTimeFormat("uk-UA", { day: "numeric", month: "long" }).format(
          new Date(`${firstDay.date}T12:00:00`)
        )} – ${new Intl.DateTimeFormat("uk-UA", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(new Date(`${lastDay.date}T12:00:00`))}`
      : "Розклад на тиждень");

  ctx.fillStyle = "#f8fafc";
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

  if (fullWeekBadge) {
    ctx.font = "600 13px Inter, system-ui, -apple-system, sans-serif";
    const badgeW = ctx.measureText(fullWeekBadge).width + 24;
    const badgeX = width - padding - badgeW;
    drawRoundedRect(ctx, badgeX, 42, badgeW, 30, 15);
    ctx.fillStyle = "#16161a";
    ctx.fill();
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#38bdf8";
    ctx.fillText(fullWeekBadge, badgeX + 12, 62);
  }

  // Розділювач шапки
  ctx.strokeStyle = "#27272a";
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

    // Шапка дня
    drawRoundedRect(ctx, colX, dayHeaderY, colW, dayHeaderH, 12);
    ctx.fillStyle = "#16161a";
    ctx.fill();
    ctx.strokeStyle = "#27272a";
    ctx.lineWidth = 1;
    ctx.stroke();

    const dateObj = new Date(`${daySchedule.date}T12:00:00`);
    const weekdayRaw = new Intl.DateTimeFormat("uk-UA", { weekday: "long" }).format(dateObj);
    const weekdayTitle = weekdayRaw.charAt(0).toUpperCase() + weekdayRaw.slice(1);
    const shortDate = new Intl.DateTimeFormat("uk-UA", {
      day: "numeric",
      month: "short",
    }).format(dateObj);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 16px Inter, system-ui, sans-serif";
    ctx.fillText(weekdayTitle, colX + 14, dayHeaderY + 25);

    ctx.fillStyle = "#a1a1aa";
    ctx.font = "500 12px Inter, system-ui, sans-serif";
    ctx.fillText(shortDate, colX + 14, dayHeaderY + 44);

    // Кількість пар або бейдж режиму навчання для дня справа в шапці дня
    const lessonsCount = daySchedule.lessons.length;
    const countLabel =
      lessonsCount === 0
        ? "пар немає"
        : `${lessonsCount} ${lessonsCount === 1 ? "пара" : lessonsCount < 5 ? "пари" : "пар"}`;
    ctx.font = "600 11px Inter, system-ui, sans-serif";
    const countW = ctx.measureText(countLabel).width;
    ctx.fillStyle = lessonsCount > 0 ? "#38bdf8" : "#71717a";
    ctx.fillText(countLabel, colX + colW - 14 - countW, dayHeaderY + 24);

    if (daySchedule.learning_mode_override) {
      const ovMode =
        daySchedule.learning_mode_override.mode === "offline" ? "Очно" : "Дистанційно";
      ctx.font = "700 10px Inter, system-ui, sans-serif";
      const ovW = ctx.measureText(ovMode).width + 12;
      const ovX = colX + colW - 14 - ovW;
      drawRoundedRect(ctx, ovX, dayHeaderY + 31, ovW, 18, 6);
      ctx.fillStyle =
        daySchedule.learning_mode_override.mode === "offline"
          ? "rgba(56, 189, 248, 0.14)"
          : "rgba(245, 158, 11, 0.14)";
      ctx.fill();
      ctx.fillStyle =
        daySchedule.learning_mode_override.mode === "offline" ? "#38bdf8" : "#fbbf24";
      ctx.fillText(ovMode, ovX + 6, dayHeaderY + 43);
    }

    // Слоти пар 1..maxSlot
    for (let slotNum = 1; slotNum <= maxSlot; slotNum++) {
      const slotY = gridTopY + (slotNum - 1) * (cardHeight + rowGap);
      const slotLessons = daySchedule.lessons
        .filter((l) => l.lesson_number === slotNum)
        .sort((a, b) => a.id - b.id);

      if (slotLessons.length === 0) {
        // Порожній слот (вікно або пар немає)
        drawRoundedRect(ctx, colX, slotY, colW, cardHeight, 12);
        ctx.fillStyle = "rgba(22, 22, 26, 0.35)";
        ctx.fill();
        ctx.strokeStyle = "rgba(39, 39, 42, 0.55)";
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = "#3f3f46";
        ctx.font = "700 16px Inter, system-ui, sans-serif";
        ctx.fillText(String(slotNum), colX + 14, slotY + 28);

        ctx.fillStyle = "#52525b";
        ctx.font = "500 12px Inter, system-ui, sans-serif";
        ctx.fillText("—", colX + 54, slotY + 50);
        continue;
      }

      const lesson = slotLessons[0];
      const item = formatLessonDetails(lesson, scheduleMode);

      drawRoundedRect(ctx, colX, slotY, colW, cardHeight, 12);
      ctx.fillStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? "rgba(225, 29, 72, 0.09)"
          : "rgba(14, 165, 233, 0.09)"
        : item.isReplacement
        ? "rgba(245, 158, 11, 0.07)"
        : "#16161a";
      ctx.fill();

      ctx.strokeStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? "rgba(225, 29, 72, 0.45)"
          : "rgba(14, 165, 233, 0.45)"
        : item.isReplacement
        ? "rgba(245, 158, 11, 0.45)"
        : "#27272a";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Ліва колонка: номер пари + час
      ctx.fillStyle = item.eventBadge
        ? item.eventBadge.bg === "#e11d48"
          ? "#fb7185"
          : "#38bdf8"
        : item.isReplacement
        ? "#fbbf24"
        : "#38bdf8";
      ctx.font = "800 18px Inter, system-ui, sans-serif";
      ctx.fillText(String(item.lessonNumber), colX + 12, slotY + 28);

      ctx.fillStyle = "#a1a1aa";
      ctx.font = "500 10px Inter, system-ui, sans-serif";
      ctx.fillText(item.startTime || "", colX + 12, slotY + 46);
      ctx.fillText(item.endTime || "", colX + 12, slotY + 60);

      // Вертикальна лінія після часу
      ctx.strokeStyle = "#27272a";
      ctx.beginPath();
      ctx.moveTo(colX + 48, slotY + 10);
      ctx.lineTo(colX + 48, slotY + cardHeight - 10);
      ctx.stroke();

      // Права частина: Предмет, викладач, кабінет / онлайн
      const textX = colX + 58;
      const hasTopBadge = Boolean(item.eventBadge || item.isReplacement);
      const maxSubjectWidth = colW - 68 - (hasTopBadge ? 56 : 0);

      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 12.5px Inter, system-ui, sans-serif";
      const subjectLines = wrapText(ctx, item.subjectName, maxSubjectWidth);
      subjectLines.forEach((line, i) => {
        ctx.fillText(line, textX, slotY + 22 + i * 15);
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
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.fillStyle = "#09090b";
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
        ctx.fillStyle = "rgba(14, 165, 233, 0.12)";
        ctx.fill();
        ctx.strokeStyle = "rgba(14, 165, 233, 0.4)";
        ctx.stroke();
        ctx.fillStyle = "#38bdf8";
        ctx.fillText(meetLabel, meetX + 6, bottomY + 12.5);
        rightX = meetX - 5;
      }

      if (item.roomText) {
        const roomStr = item.roomText;
        ctx.font = "600 10px Inter, system-ui, sans-serif";
        const roomW = ctx.measureText(roomStr).width + 12;
        const roomX = rightX - roomW;
        drawRoundedRect(ctx, roomX, bottomY, roomW, 18, 5);
        ctx.fillStyle = "#1e1e24";
        ctx.fill();
        ctx.strokeStyle = "#27272a";
        ctx.stroke();
        ctx.fillStyle = "#e4e4e7";
        ctx.fillText(roomStr, roomX + 6, bottomY + 12.5);
        rightX = roomX - 5;
      }

      // Викладач або група знизу зліва (обрізається до чіпів справа)
      if (item.secondary) {
        const maxSecW = Math.max(40, rightX - textX - 4);
        ctx.fillStyle = "#a1a1aa";
        ctx.font = "500 10.5px Inter, system-ui, sans-serif";
        let secText = item.secondary;
        while (secText.length > 3 && ctx.measureText(secText).width > maxSecW) {
          secText = secText.slice(0, -2).trimEnd() + "…";
        }
        ctx.fillText(secText, textX, slotY + cardHeight - 15);
      }
    }
  });

  // 4. Футер з часом генерації
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
      else reject(new Error("Не вдалося згенерувати зображення тижня"));
    }, "image/png");
  });
}

export async function shareWeekScheduleAsImage(
  week: ScheduleResponse[],
  scheduleMode: "student" | "teacher" | "admin",
  ownerLabel?: string,
  weekRangeLabel?: string,
  weekNumber?: number | null
): Promise<"copied" | "shared" | "downloaded"> {
  const blob = await generateWeekScheduleCardBlob(
    week,
    scheduleMode,
    ownerLabel,
    weekRangeLabel,
    weekNumber
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

