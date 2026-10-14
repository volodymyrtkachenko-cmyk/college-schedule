"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, Lesson, ReferenceRecord } from "../../lib/api";
import { formatRoom, formatTeachers } from "../../lib/format";

const DAY_NAMES_LOWER: Record<number, string> = {
  1: "понеділок",
  2: "вівторок",
  3: "середа",
  4: "четвер",
  5: "п'ятниця",
  6: "субота",
  7: "неділя",
};

function splitSubgroups(lesson?: Lesson): {
  subject: string;
  t1: string;
  r1: string;
  t2: string | null;
  r2: string | null;
} | null {
  if (!lesson) return null;
  const teachers = (lesson.teacher_name || "")
    .split("/")
    .map((s) => formatTeachers(s.trim()))
    .filter(Boolean);
  const rooms = (lesson.room || "")
    .split("/")
    .map((s) => formatRoom(s.trim()).replace(/^ауд\.?\s*/i, "").trim())
    .filter(Boolean);

  return {
    subject: lesson.subject_name,
    t1: teachers[0] || "",
    r1: rooms[0] || "",
    t2: teachers.length > 1 ? teachers[1] : null,
    r2: rooms.length > 1 ? rooms[1] : (teachers.length > 1 ? rooms[0] || "" : null),
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
  const [weekType, setWeekType] = useState<"numerator" | "denominator" | "both">("numerator");
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
        setWeekType(daySchedule.week_type);
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

  const dateObj = new Date(`${targetDate}T12:00:00`);
  const dow = dateObj.getDay() || 7;
  const formattedDate = `${String(dateObj.getDate()).padStart(2, "0")}.${String(
    dateObj.getMonth() + 1
  ).padStart(2, "0")}.${dateObj.getFullYear()}`;
  const weekLabel = weekType === "denominator" ? "знаменник" : "чисельник";

  // Сортування груп за спаданням курсу/номера (92..99, 81..91, 75..80)
  const sortedGroups = [...groups].sort((a, b) =>
    b.name.localeCompare(a.name, "uk", { numeric: true })
  );

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
          <title>РОЗКЛАД ЗАНЯТЬ на ${formattedDate}, ${DAY_NAMES_LOWER[dow] || ""}, ${weekLabel}</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 6mm 6mm;
            }
            * {
              box-sizing: border-box;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            body {
              margin: 0;
              padding: 0;
              font-family: "Times New Roman", Times, serif;
              color: #000;
              background: #fff;
              font-size: 9pt;
            }
            .header-block {
              text-align: right;
              font-weight: bold;
              font-size: 13pt;
              line-height: 1.25;
              margin-bottom: 8px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              font-size: 8.5pt;
              line-height: 1.15;
            }
            th, td {
              border: 1px solid #000;
              padding: 2px 3px;
              color: #000;
            }
            th {
              background-color: #f2f2f2;
              text-align: center;
              font-weight: bold;
            }
            .td-group {
              width: 50px;
              text-align: center;
              font-size: 11pt;
              font-weight: bold;
              vertical-align: middle;
            }
            .td-subject {
              vertical-align: top;
            }
            .td-room {
              width: 38px;
              text-align: center;
              vertical-align: bottom;
              font-weight: 500;
            }
            .subject-text {
              font-weight: 600;
              font-size: 8.5pt;
              word-break: break-word;
              line-height: 1.15;
            }
            .teacher-text {
              font-size: 8pt;
              line-height: 1.1;
            }
            tr {
              page-break-inside: avoid;
              break-inside: avoid;
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
    }, 200);
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
            size: A4 landscape;
            margin: 6mm 6mm;
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
            max-width: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: visible !important;
          }
          table.official-table {
            width: 100% !important;
            border-collapse: collapse !important;
            font-family: "Times New Roman", Times, serif !important;
            font-size: 8.5pt !important;
            line-height: 1.15 !important;
            color: #000 !important;
          }
          table.official-table th,
          table.official-table td {
            border: 1px solid #000 !important;
            color: #000 !important;
          }
          table.official-table th {
            background-color: #f3f3f3 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Панель керування (ховається під час друку) */}
      <div className="print-hide flex flex-wrap items-center justify-between gap-4 border-b border-sys-border bg-sys-card px-6 py-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">🖨️ Друк розкладу (формат адміністрації)</h2>
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

      {/* Аркуш для перегляду та друку */}
      <div className="flex-1 overflow-auto bg-white p-6 text-black print:overflow-visible print:p-0">
        {!loadedDate ? (
          <div className="py-20 text-center text-slate-500 print-hide">
            {loading
              ? "Завантажуємо розклад по всіх групах коледжу..."
              : "Оберіть дату та натисніть «Сформувати відомість», щоб згенерувати таблицю по всіх групах коледжу."}
          </div>
        ) : (
          <div ref={printSheetRef} className="print-sheet mx-auto max-w-[1200px] print:max-w-none">
            <div className="header-block mb-3 text-right font-serif text-base font-bold leading-snug">
              <div>РОЗКЛАД ЗАНЯТЬ на</div>
              <div>
                {formattedDate}, {DAY_NAMES_LOWER[dow] || ""}, {weekLabel}
              </div>
            </div>

            <table className="official-table w-full border-collapse border border-black font-serif text-[11px] leading-tight text-black">
              <thead>
                <tr className="bg-neutral-100 print:bg-neutral-100">
                  <th className="w-12 border border-black px-1 py-1 text-center font-bold">
                    Номер
                    <br />
                    групи
                  </th>
                  {[0, 1, 2, 3, 4].map((num) => (
                    <th key={`h-${num}`} colSpan={2} className="border border-black p-0">
                      <div className="grid grid-cols-[1fr_38px] divide-x divide-black">
                        <div className="flex items-center justify-center py-1 font-bold">{num}</div>
                        <div className="py-0.5 text-center text-[10px] font-normal leading-none">
                          Ном.
                          <br />
                          ауд.
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedGroups.map((group) => {
                  const groupLessons = lessonsByGroup[group.id] || {};
                  const cells = [0, 1, 2, 3, 4].map((num) => splitSubgroups(groupLessons[num]));
                  const hasSecondRow = cells.some((c) => c?.t2);

                  return (
                    <React.Fragment key={group.id}>
                      <tr key={`g-${group.id}-r1`} className="break-inside-avoid">
                        <td
                          rowSpan={hasSecondRow ? 2 : 1}
                          className="td-group border border-black px-1 py-1 text-center text-sm font-bold align-middle"
                        >
                          {group.name}
                        </td>
                        {cells.map((c, idx) => (
                          <td key={`g-${group.id}-p-${idx}-subj`} className="td-subject border border-black px-1.5 py-0.5 align-top">
                            {c ? (
                              <>
                                <div className="subject-text font-medium truncate max-w-[165px] print:max-w-none print:whitespace-normal">{c.subject}</div>
                                <div className="teacher-text text-[10.5px]">{c.t1}</div>
                              </>
                            ) : null}
                          </td>
                        )).flatMap((subjTd, idx) => [
                          subjTd,
                          <td
                            key={`g-${group.id}-p-${idx}-room`}
                            className="td-room w-[38px] border border-black px-1 py-0.5 text-center align-bottom font-medium"
                          >
                            {cells[idx]?.r1 || ""}
                          </td>,
                        ])}
                      </tr>
                      {hasSecondRow && (
                        <tr key={`g-${group.id}-r2`} className="break-inside-avoid">
                          {cells.flatMap((c, idx) => [
                            <td key={`g-${group.id}-p-${idx}-sub2`} className="td-subject border border-black px-1.5 py-0.5 align-top">
                              {c?.t2 ? <div className="teacher-text text-[10.5px]">{c.t2}</div> : null}
                            </td>,
                            <td
                              key={`g-${group.id}-p-${idx}-room2`}
                              className="td-room w-[38px] border border-black px-1 py-0.5 text-center align-bottom font-medium"
                            >
                              {c?.t2 ? c.r2 || "" : ""}
                            </td>,
                          ])}
                        </tr>
                      )}
                    </React.Fragment>
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
