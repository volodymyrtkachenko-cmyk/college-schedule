"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, Lesson, ReferenceRecord } from "../../lib/api";

const DAY_NAMES_LOWER: Record<number, string> = {
  1: "понеділок",
  2: "вівторок",
  3: "середа",
  4: "четвер",
  5: "п'ятниця",
  6: "субота",
  7: "неділя",
};

// За замовчуванням порядок груп як в оригіналі адміністрації:
// блоки 92–99, 87–89, 90–91, 81–86, 75–80
const DEFAULT_GROUPS_ORDER = [
  92, 93, 94, 95, 96, 97, 98, 99,
  87, 88, 89, 90, 91,
  81, 82, 83, 84, 85, 86,
  75, 76, 77, 78, 79, 80,
];

function normalizeRoomText(room: string): string {
  const clean = room.trim();
  const lower = clean.toLowerCase();

  if (lower.includes("спорт") || lower.startsWith("ск")) {
    const match = lower.match(/[1-3]/);
    return match ? `ск${match[0]}` : "СК";
  }
  if (lower.startsWith("дист")) {
    return "дист";
  }
  return clean.replace(/^ауд\.?\s*/i, "").trim();
}

function computeWeekType(targetDateStr: string): "чисельник" | "знаменник" {
  const [y, m, d] = targetDateStr.split("-").map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d));
  const anchorDate = new Date(Date.UTC(2026, 8, 7)); // 2026-09-07 = знаменник (month index 8 is September)
  const diffMs = targetDate.getTime() - anchorDate.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const weekIndex = Math.floor(diffDays / 7);
  return Math.abs(weekIndex) % 2 === 0 ? "знаменник" : "чисельник";
}

function getSubjectTypography(subject: string): { fontSize: string; lineHeight: string } {
  const len = subject.length;
  if (len > 68) {
    return { fontSize: "7pt", lineHeight: "8.5pt" };
  }
  if (len > 48) {
    return { fontSize: "8pt", lineHeight: "9.5pt" };
  }
  if (len > 28) {
    return { fontSize: "9pt", lineHeight: "10.5pt" };
  }
  return { fontSize: "10pt", lineHeight: "11.5pt" };
}

interface CellContent {
  subject: string;
  t1: string;
  r1: string;
  t2: string | null;
  r2: string | null;
}

function splitSubgroups(lesson?: Lesson): CellContent | null {
  if (!lesson) return null;
  const teachers = (lesson.teacher_name || "")
    .split(/\s*[/]\s*|\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const rooms = (lesson.room || "")
    .split(/\s*[,/;]\s*/)
    .map(normalizeRoomText)
    .filter(Boolean);

  const t1 = teachers[0] || "";
  const t2 = teachers.length > 1 ? teachers[1] : null;

  let r1 = "";
  let r2: string | null = null;

  if (t2) {
    if (rooms.length >= 2) {
      r1 = rooms[0];
      r2 = rooms[1];
    } else if (rooms.length === 1) {
      r1 = rooms[0];
      r2 = rooms[0];
    }
  } else {
    r1 = rooms[0] || "";
    r2 = null;
  }

  return {
    subject: lesson.subject_name || lesson.subject || "",
    t1,
    r1,
    t2,
    r2,
  };
}

export function OfficialPrintModal({
  groups,
  defaultDate,
  onClose,
}: {
  groups: ReferenceRecord[];
  defaultDate: string;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [loading, setLoading] = useState(false);
  const [lessonsByGroup, setLessonsByGroup] = useState<Record<number, Record<number, Lesson>>>({});
  const [loadedDate, setLoadedDate] = useState<string | null>(null);

  const printSheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const loadDayForAllGroups = async (dateStr: string) => {
    setLoading(true);
    try {
      const dateObj = new Date(`${dateStr}T12:00:00`);
      const weekData = await api.week(undefined, undefined, dateObj);
      const daySchedule = weekData.find((d) => d.date === dateStr) ?? weekData[0];
      if (daySchedule) {
        const map: Record<number, Record<number, Lesson>> = {};
        for (const item of daySchedule.lessons) {
          if (!item.group_id) continue;
          if (!map[item.group_id]) map[item.group_id] = {};
          map[item.group_id][item.lesson_number] = item;
        }
        setLessonsByGroup(map);
        setLoadedDate(dateStr);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (defaultDate && !loadedDate) {
      void loadDayForAllGroups(defaultDate);
    }
  }, [defaultDate]);

  const [y, m, d] = targetDate.split("-").map(Number);
  const dateObj = new Date(Date.UTC(y, m - 1, d));
  const dow = dateObj.getUTCDay() || 7;
  const formattedDate = `${String(d).padStart(2, "0")}.${String(m).padStart(2, "0")}.${y}`;
  const weekLabel = computeWeekType(targetDate);

  // Сортування груп за оригінальним порядком MS Access адміністрації:
  // 92..99, 87..89, 90..91, 81..86, 75..80
  const sortedGroups = [...groups].sort((a, b) => {
    const numA = parseInt(a.name, 10);
    const numB = parseInt(b.name, 10);
    const idxA = DEFAULT_GROUPS_ORDER.indexOf(numA);
    const idxB = DEFAULT_GROUPS_ORDER.indexOf(numB);
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return a.name.localeCompare(b.name, "uk", { numeric: true });
  });

  const handlePrint = () => {
    if (!printSheetRef.current) {
      window.print();
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>rozklad_${targetDate}</title>
          <style>
            @font-face {
              font-family: 'Arimo';
              font-style: normal;
              font-weight: 400;
              src: local('Arimo'), local('Arial'), url('/fonts/Arimo-Regular.ttf') format('truetype');
            }
            @font-face {
              font-family: 'Arimo';
              font-style: normal;
              font-weight: 700;
              src: local('Arimo Bold'), local('Arimo-Bold'), local('Arial Bold'), local('Arial-Bold'), url('/fonts/Arimo-Bold.ttf') format('truetype');
            }
            @font-face {
              font-family: 'Arimo';
              font-style: italic;
              font-weight: 400;
              src: local('Arimo Italic'), local('Arimo-Italic'), local('Arial Italic'), local('Arial-Italic'), url('/fonts/Arimo-Italic.ttf') format('truetype');
            }
            @font-face {
              font-family: 'Arimo';
              font-style: italic;
              font-weight: 700;
              src: local('Arimo Bold Italic'), local('Arimo-BoldItalic'), local('Arial Bold Italic'), local('Arial-BoldItalic'), url('/fonts/Arimo-BoldItalic.ttf') format('truetype');
            }
            @font-face {
              font-family: 'Cousine';
              font-style: normal;
              font-weight: 700;
              src: local('Cousine Bold'), local('Cousine-Bold'), local('Courier New Bold'), local('Courier New'), url('/fonts/Cousine-Bold.ttf') format('truetype');
            }
            @font-face {
              font-family: 'Tinos';
              font-style: normal;
              font-weight: 700;
              src: local('Tinos Bold'), local('Tinos-Bold'), local('Times New Roman Bold'), local('Times New Roman'), url('/fonts/Tinos-Bold.ttf') format('truetype');
            }

            @page {
              size: 297mm 210mm;
              margin: 7.8mm 7.5mm 6mm 6mm;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            html, body {
              margin: 0;
              padding: 0;
              width: 283mm;
              font-family: "Arimo", "Arial", sans-serif;
              color: #000;
              background: #fff;
              -webkit-font-smoothing: antialiased;
            }
            .header-title {
              font-family: "Cousine", "Courier New", monospace;
              font-weight: 700;
              font-size: 20pt;
              text-align: center;
              line-height: 1.1;
              margin: 0 0 10pt 0;
              white-space: nowrap;
            }
            table.schedule-table {
              table-layout: fixed;
              width: 283mm;
              border-collapse: collapse;
              margin: 0;
            }
            thead {
              display: table-header-group;
            }
            tfoot {
              display: table-footer-group;
            }
            tfoot td {
              border: none !important;
              padding-top: 4pt !important;
              font-family: "Arimo", "Arial", sans-serif;
              font-size: 7pt;
              color: #000;
              text-align: left;
            }
            th {
              height: 25pt;
              border: 1px solid #000;
              background-color: #f2f2f2;
              padding: 0 1pt;
              vertical-align: middle;
            }
            thead tr {
              height: 25pt;
            }
            th.th-group {
              width: 14mm;
              font-size: 9pt;
              font-weight: 700;
              text-align: center;
              line-height: 1.1;
            }
            th.th-slot {
              font-family: "Tinos", "Times New Roman", serif;
              font-size: 14pt;
              font-weight: 700;
              text-align: center;
              width: 44.8mm;
            }
            th.th-room {
              width: 9mm;
              font-size: 7pt;
              font-weight: normal;
              text-align: center;
              line-height: 1.05;
            }
            tr.group-row {
              height: 43.5pt;
              min-height: 43.5pt;
              border-bottom: 2pt solid #000;
              page-break-inside: avoid;
              break-inside: avoid;
            }
            td.td-group {
              width: 14mm;
              border: 1px solid #000;
              font-size: 22pt;
              font-weight: 700;
              text-align: center;
              vertical-align: middle;
              line-height: 1;
              padding: 0;
            }
            td.td-slot {
              padding: 0 !important;
              vertical-align: top !important;
              height: 43.5pt;
              min-height: 43.5pt;
              background: linear-gradient(#000, #000) no-repeat calc(100% - 9mm) 0 / 1px 100%;
            }
            .cell-grid {
              display: grid;
              grid-template-columns: 1fr 9mm;
              align-content: start;
              grid-auto-rows: min-content;
              font-size: 10pt;
              padding: 2pt 0;
              min-height: 43.5pt;
            }
            .subj, .subj-text {
              padding: 0 3pt 2pt 3pt;
              font-weight: 700;
              color: #000;
              overflow-wrap: break-word;
              word-wrap: break-word;
            }
            .teacher, .teacher-text {
              padding: 0 3pt;
              font-style: italic;
              color: #000;
              font-size: 10pt !important;
              line-height: 11pt !important;
              height: 11pt;
              white-space: nowrap;
              overflow: hidden;
            }
            .room, .room-text {
              text-align: center;
              color: #1f4e8c;
              font-weight: 700;
              font-size: 10pt !important;
              line-height: 11pt !important;
              height: 11pt;
              overflow: hidden;
              white-space: nowrap;
            }
            .room-empty {
              height: 11pt;
            }
          </style>
        </head>
        <body>
          ${printSheetRef.current.innerHTML}
        </body>
      </html>
    `);
    doc.close();

    iframe.contentWindow?.focus();
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch {
        window.print();
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1500);
      }
    }, 250);
  };

  if (!mounted) return null;

  return createPortal(
    <div
      id="official-print-portal"
      className="fixed inset-0 z-[120] flex flex-col bg-black/80 backdrop-blur-sm print:static print:bg-white"
    >
      <style>{`
        @media print {
          @page {
            size: 297mm 210mm;
            margin: 7.8mm 7.5mm 6mm 6mm;
          }
          html, body {
            background: #fff !important;
            color: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
            height: auto !important;
            overflow: visible !important;
          }
          body > *:not(#official-print-portal) {
            display: none !important;
          }
          #official-print-portal {
            display: block !important;
            position: static !important;
            width: 100% !important;
            background: #fff !important;
            color: #000 !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          .print-hide {
            display: none !important;
          }
          .print-sheet {
            width: 283mm !important;
            max-width: none !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          table.schedule-table {
            table-layout: fixed !important;
            width: 283mm !important;
            border-collapse: collapse !important;
          }
          th {
            height: 25pt !important;
          }
          td.td-slot {
            padding: 0 !important;
            vertical-align: top !important;
            height: 43.5pt !important;
            min-height: 43.5pt !important;
            background: linear-gradient(#000, #000) no-repeat calc(100% - 9mm) 0 / 1px 100% !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .cell-grid {
            display: grid !important;
            grid-template-columns: 1fr 9mm !important;
            align-content: start !important;
            grid-auto-rows: min-content !important;
            font-size: 10pt !important;
            padding: 2pt 0 !important;
            min-height: 43.5pt !important;
          }
          .subj, .subj-text {
            padding: 0 3pt 2pt 3pt !important;
            font-weight: 700 !important;
            color: #000 !important;
            overflow-wrap: break-word !important;
            word-wrap: break-word !important;
          }
          .teacher, .teacher-text {
            padding: 0 3pt !important;
            font-style: italic !important;
            color: #000 !important;
            font-size: 10pt !important;
            line-height: 11pt !important;
            height: 11pt !important;
            white-space: nowrap !important;
            overflow: hidden !important;
          }
          .room, .room-text {
            text-align: center !important;
            color: #1f4e8c !important;
            font-weight: 700 !important;
            font-size: 10pt !important;
            line-height: 11pt !important;
            height: 11pt !important;
            overflow: hidden !important;
            white-space: nowrap !important;
          }
          .room-empty {
            height: 11pt !important;
          }
        }
      `}</style>

      {/* Панель керування (ховається під час друку) */}
      <div className="print-hide flex flex-wrap items-center justify-between gap-4 border-b border-sys-border bg-sys-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">🖨️ Офіційний розклад (формат адміністрації)</h2>
          <input
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className="form-control py-1.5 text-sm"
          />
          <button
            type="button"
            onClick={() => void loadDayForAllGroups(targetDate)}
            disabled={loading}
            className="rounded-lg bg-sys-accent px-4 py-1.5 text-sm font-semibold text-[#0b1120] disabled:opacity-50"
          >
            {loading ? "Формуємо..." : "Сформувати відомість"}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {loadedDate && (
            <button
              type="button"
              onClick={handlePrint}
              className="rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-bold text-slate-950 hover:bg-emerald-400"
            >
              Роздрукувати / Зберегти PDF
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-sys-border px-3 py-1.5 text-sm text-sys-text-secondary hover:text-white"
          >
            Закрити
          </button>
        </div>
      </div>

      {/* Аркуш для попереднього перегляду та друку */}
      <div className="flex-1 overflow-auto bg-white p-6 text-black print:overflow-visible print:p-0">
        {!loadedDate ? (
          <div className="py-20 text-center text-slate-500 print-hide">
            {loading
              ? "Завантажуємо розклад по всіх групах коледжу..."
              : "Оберіть дату та натисніть «Сформувати відомість», щоб згенерувати таблицю по всіх групах коледжу."}
          </div>
        ) : (
          <div ref={printSheetRef} className="print-sheet mx-auto w-[283mm] print:w-[283mm]">
            {/* Заголовок по центру: Courier New Bold 20pt в один рядок */}
            <h1 className="header-title font-mono font-bold text-[20pt] text-center leading-tight mb-2 text-black whitespace-nowrap">
              РОЗКЛАД ЗАНЯТЬ на {formattedDate}, {DAY_NAMES_LOWER[dow] || ""}, {weekLabel}
            </h1>

            {/* Таблиця розкладу: table-layout fixed, ширина 283mm */}
            <table className="schedule-table w-[283mm] table-fixed border-collapse border border-black font-sans text-black">
              <colgroup>
                {/* 1. Номер групи: 14mm */}
                <col style={{ width: "14mm" }} />
                {/* 5 слотів (0, 1, 2, 3, 4): текст 44.8mm + ауд 9mm */}
                {[0, 1, 2, 3, 4].map((slot) => (
                  <React.Fragment key={`col-slot-${slot}`}>
                    <col style={{ width: "44.8mm" }} />
                    <col style={{ width: "9mm" }} />
                  </React.Fragment>
                ))}
              </colgroup>

              {/* Шапка: 25pt, повторюється на кожній сторінці */}
              <thead className="table-header-group">
                <tr className="bg-neutral-100 print:bg-neutral-100 h-[25pt]">
                  <th className="th-group border border-black px-1 py-0 text-center font-bold text-[9pt] leading-tight">
                    Номер
                    <br />
                    групи
                  </th>
                  {[0, 1, 2, 3, 4].map((num) => (
                    <React.Fragment key={`head-pair-${num}`}>
                      <th className="th-slot border border-black px-1 py-0 text-center font-serif font-bold text-[14pt]">
                        {num}
                      </th>
                      <th className="th-room border border-black px-0.5 py-0 text-center font-sans font-normal text-[7pt] leading-none">
                        Ном.
                        <br />
                        ауд.
                      </th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>

              {/* Футер: знизу ліворуч, 7pt, на кожній сторінці */}
              <tfoot className="table-footer-group">
                <tr>
                  <td
                    colSpan={11}
                    className="border-none pt-1 font-sans text-[7pt] text-black text-left"
                  >
                    {DAY_NAMES_LOWER[dow] || ""}, {weekLabel}
                  </td>
                </tr>
              </tfoot>

              <tbody>
                {sortedGroups.map((group) => {
                  const groupLessons = lessonsByGroup[group.id] || {};
                  const cells = [0, 1, 2, 3, 4].map((num) =>
                    splitSubgroups(groupLessons[num])
                  );

                  return (
                    <tr
                      key={`g-${group.id}`}
                      className="group-row border-b-2 border-black h-[43.5pt] min-h-[43.5pt] break-inside-avoid"
                    >
                      {/* Номер групи: Arial Bold 22pt по центру клітинки */}
                      <td className="td-group border border-black text-center align-middle font-bold text-[22pt] leading-none px-0 py-1">
                        {group.name}
                      </td>

                      {/* 5 слотів (0, 1, 2, 3, 4), кожен слот colspan=2 із 2-колонковим Grid 1fr 9mm */}
                      {cells.map((c, idx) => {
                        if (!c) {
                          return (
                            <td
                              key={`g-${group.id}-slot-${idx}`}
                              colSpan={2}
                              className="td-slot border border-black"
                              style={{
                                background:
                                  "linear-gradient(#000, #000) no-repeat calc(100% - 9mm) 0 / 1px 100%",
                              }}
                            />
                          );
                        }

                        const typo = getSubjectTypography(c.subject);
                        const isMulti = Boolean(c.t2);

                        return (
                          <td
                            key={`g-${group.id}-slot-${idx}`}
                            colSpan={2}
                            className="td-slot border border-black"
                            style={{
                              background:
                                "linear-gradient(#000, #000) no-repeat calc(100% - 9mm) 0 / 1px 100%",
                            }}
                          >
                            <div
                              className="cell-grid"
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 9mm",
                                alignContent: "start",
                                gridAutoRows: "min-content",
                                fontSize: "10pt",
                                padding: "2pt 0",
                                minHeight: "43.5pt",
                              }}
                            >
                              {isMulti ? (
                                <>
                                  {/* Рядок 1: Назва предмета + порожнє місце під ауд */}
                                  <div
                                    className="subj-text font-bold text-black"
                                    style={{
                                      fontSize: typo.fontSize,
                                      lineHeight: typo.lineHeight,
                                      padding: "0 3pt 2pt 3pt",
                                      overflowWrap: "break-word",
                                      wordWrap: "break-word",
                                    }}
                                  >
                                    {c.subject}
                                  </div>
                                  <div className="room-empty" style={{ height: "11pt" }}></div>

                                  {/* Рядок 2: Викладач 1 + Аудиторія 1 */}
                                  <div
                                    className="teacher-text italic text-[10pt] leading-[11pt] text-black"
                                    style={{
                                      fontSize: "10pt",
                                      lineHeight: "11pt",
                                      padding: "0 3pt",
                                      height: "11pt",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {c.t1}
                                  </div>
                                  <div
                                    className="room-text font-bold text-[#1f4e8c] text-[10pt] leading-[11pt]"
                                    style={{
                                      fontSize: "10pt",
                                      lineHeight: "11pt",
                                      textAlign: "center",
                                      height: "11pt",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {c.r1}
                                  </div>

                                  {/* Рядок 3: Викладач 2 + Аудиторія 2 */}
                                  <div
                                    className="teacher-text italic text-[10pt] leading-[11pt] text-black"
                                    style={{
                                      fontSize: "10pt",
                                      lineHeight: "11pt",
                                      padding: "0 3pt",
                                      height: "11pt",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {c.t2}
                                  </div>
                                  <div
                                    className="room-text font-bold text-[#1f4e8c] text-[10pt] leading-[11pt]"
                                    style={{
                                      fontSize: "10pt",
                                      lineHeight: "11pt",
                                      textAlign: "center",
                                      height: "11pt",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {c.r2 || ""}
                                  </div>
                                </>
                              ) : (
                                <>
                                  {/* Рядок 1: Назва предмета + Аудиторія (як в оригіналі) */}
                                  <div
                                    className="subj-text font-bold text-black"
                                    style={{
                                      fontSize: typo.fontSize,
                                      lineHeight: typo.lineHeight,
                                      padding: "0 3pt 2pt 3pt",
                                      overflowWrap: "break-word",
                                      wordWrap: "break-word",
                                    }}
                                  >
                                    {c.subject}
                                  </div>
                                  <div
                                    className="room-text font-bold text-[#1f4e8c] text-[10pt] leading-[11pt]"
                                    style={{
                                      fontSize: "10pt",
                                      lineHeight: "11pt",
                                      textAlign: "center",
                                      height: "11pt",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {c.r1}
                                  </div>

                                  {/* Рядок 2: Викладач + порожнє місце під ауд */}
                                  <div
                                    className="teacher-text italic text-[10pt] leading-[11pt] text-black"
                                    style={{
                                      fontSize: "10pt",
                                      lineHeight: "11pt",
                                      padding: "0 3pt",
                                      height: "11pt",
                                      overflow: "hidden",
                                      whiteSpace: "nowrap",
                                    }}
                                  >
                                    {c.t1}
                                  </div>
                                  <div className="room-empty" style={{ height: "11pt" }}></div>
                                </>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
