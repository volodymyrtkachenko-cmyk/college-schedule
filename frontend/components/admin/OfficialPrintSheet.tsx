"use client";

import React, { useState } from "react";
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
    r2: rooms.length > 1 ? rooms[1] : teachers.length > 1 ? rooms[0] || "" : null,
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
  const [targetDate, setTargetDate] = useState(defaultDate);
  const [loading, setLoading] = useState(false);
  const [lessonsByGroup, setLessonsByGroup] = useState<Record<number, Record<number, Lesson>>>({});
  const [weekType, setWeekType] = useState<"numerator" | "denominator" | "both">("numerator");
  const [loadedDate, setLoadedDate] = useState<string | null>(null);

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

  const dateObj = new Date(`${targetDate}T12:00:00`);
  const dow = dateObj.getDay() || 7;
  const formattedDate = `${String(dateObj.getDate()).padStart(2, "0")}.${String(
    dateObj.getMonth() + 1
  ).padStart(2, "0")}.${dateObj.getFullYear()}`;
  const weekLabel = weekType === "denominator" ? "знаменник" : "чисельник";

  // Сортування груп як у відомості адміністрації за спаданням курсу/номера (92..99, 81..91, 75..80)
  const sortedGroups = [...groups].sort((a, b) =>
    b.name.localeCompare(a.name, "uk", { numeric: true })
  );

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-black/80 backdrop-blur-sm print:static print:bg-white">
      {/* Панель керування (ховається під час друку) */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-sys-border bg-sys-card px-6 py-4 print:hidden">
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
              onClick={() => window.print()}
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
          <div className="py-20 text-center text-slate-500 print:hidden">
            Оберіть дату та натисніть «Сформувати відомість», щоб згенерувати таблицю по всіх групах коледжу.
          </div>
        ) : (
          <div className="mx-auto max-w-[1100px] print:max-w-none">
            <div className="mb-3 text-right font-serif text-base font-bold leading-snug">
              <div>РОЗКЛАД ЗАНЯТЬ на</div>
              <div>
                {formattedDate}, {DAY_NAMES_LOWER[dow] || ""}, {weekLabel}
              </div>
            </div>

            <table className="w-full border-collapse border border-black font-serif text-[11px] leading-tight text-black">
              <thead>
                <tr className="bg-neutral-100 print:bg-transparent">
                  <th className="w-12 border border-black px-1 py-1 text-center font-bold">
                    Номер
                    <br />
                    групи
                  </th>
                  {[0, 1, 2, 3, 4].map((num) => (
                    <th key={`h-${num}`} colSpan={2} className="border border-black p-0">
                      <div className="grid grid-cols-[1fr_38px] divide-x divide-black">
                        <div className="flex items-center justify-center py-1 font-bold">{num}</div>
                        <div className=" py-0.5 text-center text-[10px] font-normal leading-none">
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
                          className="border border-black px-1 py-1 text-center text-sm font-bold align-middle"
                        >
                          {group.name}
                        </td>
                        {cells.map((c, idx) => (
                          <td key={`g-${group.id}-p-${idx}-subj`} className="border border-black px-1.5 py-0.5 align-top">
                            {c ? (
                              <>
                                <div className="font-medium truncate max-w-[165px]">{c.subject}</div>
                                <div className="text-[10.5px]">{c.t1}</div>
                              </>
                            ) : null}
                          </td>
                        )).flatMap((subjTd, idx) => [
                          subjTd,
                          <td
                            key={`g-${group.id}-p-${idx}-room`}
                            className="w-[38px] border border-black px-1 py-0.5 text-center align-bottom font-medium"
                          >
                            {cells[idx]?.r1 || ""}
                          </td>,
                        ])}
                      </tr>
                      {hasSecondRow && (
                        <tr key={`g-${group.id}-r2`} className="break-inside-avoid">
                          {cells.flatMap((c, idx) => [
                            <td key={`g-${group.id}-p-${idx}-sub2`} className="border border-black px-1.5 py-0.5 align-top">
                              {c?.t2 ? <div className="text-[10.5px]">{c.t2}</div> : null}
                            </td>,
                            <td
                              key={`g-${group.id}-p-${idx}-room2`}
                              className="w-[38px] border border-black px-1 py-0.5 text-center align-bottom font-medium"
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
    </div>
  );
}
