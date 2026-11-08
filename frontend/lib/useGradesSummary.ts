"use client";

import { useMemo } from "react";
import { FullTaskItem } from "../components/MobileTasksView";
import {
  normalizeSubjectName,
  formatTeachers,
  isSubjectMatch,
  extractTeacherFromSubject,
  isValidTeacherName,
} from "./format";

export type GradeScaleType = "auto" | "12" | "5" | "100";
export type ResolvedScaleType = "12" | "5" | "100";

export interface GradeItem {
  id: string;
  title: string;
  subject: string;
  teacher?: string | null;
  rawGrade: number;
  maxPoints: number;
  originalMaxPoints?: number | null;
  isCorrectedScale: boolean;
  grade5: number;
  grade12: number;
  percentage: number;
  date?: string | null;
  url?: string | null;
}

export interface SubjectSummary {
  subject: string;
  teacher?: string | null;
  grades: GradeItem[];
  average5: number;
  average12: number | null;
  has12Scale: boolean;
  scaleType: ResolvedScaleType;
  scaleOverride: GradeScaleType | null;
  isAutoDetectedScale: boolean;
  hasCorrectedGrades: boolean;
  distribution: {
    count5: number;
    count4: number;
    count3: number;
    count2: number;
  };
  level: "excellent" | "good" | "satisfactory" | "risk";
}

export interface GradesSummaryResult {
  overallGpa5: number;
  overallAverage12: number | null;
  totalGradesCount: number;
  totalSubjectsCount: number;
  distribution: {
    count5: number;
    count4: number;
    count3: number;
    count2: number;
  };
  subjects: SubjectSummary[];
}

export interface ConvertGradeOptions {
  targetScale?: ResolvedScaleType;
}

export interface ConvertGradeResult {
  grade5: number;
  grade12: number;
  percentage: number;
  effectiveMax: number;
  isNative12: boolean;
  isCorrectedScale: boolean;
  originalMaxPoints: number | null;
}

/**
 * Detects the most appropriate grading scale for a subject based on sibling grades
 * and any manual user override.
 */
export function detectSubjectScale(
  grades: Array<{ rawGrade: number; maxPoints?: number | null }>,
  override?: GradeScaleType | null
): { detectedScale: ResolvedScaleType; isAuto: boolean; activeScale: ResolvedScaleType } {
  if (override && override !== "auto") {
    return { detectedScale: override, isAuto: false, activeScale: override };
  }

  // 1. Any raw grade > 12 -> clearly multi-point or 100-point rating scale
  const hasAbove12 = grades.some((g) => g.rawGrade > 12);
  if (hasAbove12) {
    return { detectedScale: "100", isAuto: true, activeScale: "100" };
  }

  // 2. Any explicit 12-point maxPoints (6..12) OR any rawGrade in 6..12:
  // Cannot be a 5-point scale. When maxPoints is default 100 (or >= 20) in Ukrainian colleges,
  // grades like 6..12 represent the Ukrainian national 12-point scale.
  const has12Indicators = grades.some(
    (g) =>
      (g.maxPoints != null && g.maxPoints > 5 && g.maxPoints <= 12) ||
      (g.rawGrade > 5 && g.rawGrade <= 12)
  );
  if (has12Indicators) {
    return { detectedScale: "12", isAuto: true, activeScale: "12" };
  }

  // 3. All raw grades are <= 5:
  if (grades.length > 0 && grades.every((g) => g.rawGrade <= 5)) {
    return { detectedScale: "5", isAuto: true, activeScale: "5" };
  }

  // Default fallback for empty or normal assignments
  return { detectedScale: "12", isAuto: true, activeScale: "12" };
}

/**
 * Converts a raw score and maxPoints into Ukrainian 5-point and 12-point scales,
 * auto-correcting accidental default 100-point assignments when teachers grade on a 12- or 5-point scale.
 */
export function convertGrade(
  rawGrade: number,
  maxPointsInput?: number | null,
  options?: ConvertGradeOptions
): ConvertGradeResult {
  const rawMax = maxPointsInput && maxPointsInput > 0 ? maxPointsInput : null;
  let effectiveMax: number;
  let isCorrectedScale = false;
  let originalMaxPoints: number | null = null;
  let isNative12 = false;

  const targetScale = options?.targetScale;

  if (targetScale === "12") {
    if (rawMax !== null && rawMax >= 20 && rawGrade <= 12) {
      effectiveMax = 12;
      isCorrectedScale = true;
      originalMaxPoints = rawMax;
      isNative12 = true;
    } else if (rawMax !== null) {
      effectiveMax = rawMax;
      originalMaxPoints = rawMax;
      isNative12 = rawMax <= 12 && rawMax > 5;
    } else {
      effectiveMax = 12;
      isNative12 = true;
    }
  } else if (targetScale === "5") {
    if (rawMax !== null && rawMax >= 20 && rawGrade <= 5) {
      effectiveMax = 5;
      isCorrectedScale = true;
      originalMaxPoints = rawMax;
    } else if (rawMax !== null) {
      effectiveMax = rawMax;
      originalMaxPoints = rawMax;
      isNative12 = rawMax <= 12 && rawMax > 5;
    } else {
      effectiveMax = 5;
    }
  } else if (targetScale === "100") {
    effectiveMax = rawMax || 100;
    originalMaxPoints = rawMax;
    isNative12 = false;
  } else {
    // Standalone conversion without subject context
    if (rawMax !== null && rawMax >= 20) {
      if (rawGrade > 5 && rawGrade <= 12) {
        effectiveMax = 12;
        isCorrectedScale = true;
        originalMaxPoints = rawMax;
        isNative12 = true;
      } else if (rawGrade <= 5) {
        effectiveMax = 5;
        isCorrectedScale = true;
        originalMaxPoints = rawMax;
      } else {
        effectiveMax = rawMax;
        originalMaxPoints = rawMax;
      }
    } else if (rawMax !== null) {
      effectiveMax = rawMax;
      originalMaxPoints = rawMax;
      isNative12 = rawMax <= 12 && rawMax > 5;
    } else {
      effectiveMax = rawGrade <= 5 ? 5 : rawGrade <= 12 ? 12 : 100;
      isNative12 = effectiveMax <= 12 && effectiveMax > 5;
    }
  }

  const percentage = Math.min(100, Math.max(0, Math.round((rawGrade / effectiveMax) * 100)));

  let grade5: number;
  let grade12: number;

  if (effectiveMax <= 5) {
    grade5 = Math.max(1, Math.min(5, Math.round(rawGrade)));
    // Equivalent 12-point
    if (grade5 === 5) grade12 = 12;
    else if (grade5 === 4) grade12 = 9;
    else if (grade5 === 3) grade12 = 6;
    else if (grade5 === 2) grade12 = 3;
    else grade12 = 1;
  } else if (effectiveMax <= 12) {
    isNative12 = true;
    grade12 = Math.max(1, Math.min(12, Math.round(rawGrade)));
    // Official Ukrainian collegiate conversion table
    if (grade12 >= 10) grade5 = 5;
    else if (grade12 >= 7) grade5 = 4;
    else if (grade12 >= 4) grade5 = 3;
    else grade5 = 2;
  } else {
    // Scaled from 100 or other max points
    if (percentage >= 90) grade5 = 5;
    else if (percentage >= 75) grade5 = 4;
    else if (percentage >= 60) grade5 = 3;
    else grade5 = 2;

    // 12-point equivalent from percentage
    if (percentage >= 95) grade12 = 12;
    else if (percentage >= 90) grade12 = 11;
    else if (percentage >= 85) grade12 = 10;
    else if (percentage >= 80) grade12 = 9;
    else if (percentage >= 75) grade12 = 8;
    else if (percentage >= 70) grade12 = 7;
    else if (percentage >= 65) grade12 = 6;
    else if (percentage >= 60) grade12 = 5;
    else if (percentage >= 50) grade12 = 4;
    else if (percentage >= 40) grade12 = 3;
    else if (percentage >= 20) grade12 = 2;
    else grade12 = 1;
  }

  return {
    grade5,
    grade12,
    percentage,
    effectiveMax,
    isNative12,
    isCorrectedScale,
    originalMaxPoints,
  };
}

/**
 * Returns formatted grade text for task items in tasks view and sidebar.
 */
export function formatTaskGradeDisplay(
  assignedGrade?: number | null,
  maxPoints?: number | null,
  _subject?: string
): { text: string; isCorrected: boolean; originalMax: number | null } | null {
  if (assignedGrade === undefined || assignedGrade === null) return null;

  const conv = convertGrade(assignedGrade, maxPoints);

  let text: string;
  if (conv.effectiveMax <= 12 && conv.effectiveMax > 5) {
    text = `Оцінка: ${assignedGrade} / 12 б.`;
  } else if (conv.effectiveMax <= 5) {
    text = `Оцінка: ${assignedGrade} / 5 б.`;
  } else {
    text = `Оцінка: ${assignedGrade}/${conv.effectiveMax}`;
  }

  return {
    text,
    isCorrected: conv.isCorrectedScale,
    originalMax: conv.originalMaxPoints,
  };
}

function getScheduleTeacherForSubject(subjectName: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const normSubj = normalizeSubjectName(subjectName).toLowerCase().trim();
    if (!normSubj) return null;

    // 1. Get personal teachers from localStorage
    let personalTeachers: string[] = [];
    try {
      const pRaw = window.localStorage.getItem("schedule:classroom_personal_teachers");
      if (pRaw) personalTeachers = JSON.parse(pRaw);
    } catch {}

    // 2. Scan cached weekly schedules and today schedules in localStorage
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && (k.startsWith("schedule:week:") || k.startsWith("schedule:today:"))) {
        keys.push(k);
      }
    }

    for (let i = 0; i < keys.length; i++) {
      try {
        const raw = window.localStorage.getItem(keys[i]);
        if (!raw) continue;
        const data = JSON.parse(raw);
        const days = Array.isArray(data) ? data : Array.isArray(data.days) ? data.days : [data];
        for (let j = 0; j < days.length; j++) {
          const day = days[j];
          if (!day || !day.lessons) continue;
          for (let k = 0; k < day.lessons.length; k++) {
            const l = day.lessons[k];
            const lSubj = normalizeSubjectName(l.subject_name || l.subject || "").toLowerCase().trim();
            if (lSubj && (lSubj === normSubj || isSubjectMatch(lSubj, normSubj))) {
              const tRaw = l.teacher_name || l.teacher;
              if (tRaw && isValidTeacherName(tRaw)) {
                if (/[,/]/.test(tRaw) && personalTeachers.length > 0) {
                  const parts = tRaw.split(/\s*[,/]\s*/);
                  for (let p = 0; p < parts.length; p++) {
                    const pSurname = parts[p].trim().split(/[\s.]+/)[0].toLowerCase();
                    for (let ptIdx = 0; ptIdx < personalTeachers.length; ptIdx++) {
                      if (personalTeachers[ptIdx].toLowerCase().includes(pSurname)) {
                        return formatTeachers(parts[p].trim());
                      }
                    }
                  }
                }
                return formatTeachers(tRaw);
              }
            }
          }
        }
      } catch {}
    }

    // 3. Fallback: match from directory teachers schedule:teachers
    try {
      const dRaw = window.localStorage.getItem("schedule:teachers");
      if (dRaw) {
        const dirTeachers: Array<{ id: number; name: string }> = JSON.parse(dRaw);
        for (let i = 0; i < dirTeachers.length; i++) {
          const dt = dirTeachers[i];
          const surname = dt.name.trim().split(/[\s.]+/)[0].toLowerCase();
          if (surname.length >= 3 && normSubj.includes(surname)) {
            return formatTeachers(dt.name);
          }
        }
      }
    } catch {}
  } catch {}
  return null;
}

export function useGradesSummary(tasks: FullTaskItem[]): GradesSummaryResult {
  return useMemo(() => {
    // 1. Gather teachers from ALL tasks (not just graded ones), including raw subject extraction
    const teacherMap = new Map<string, string>();
    for (let i = 0; i < tasks.length; i++) {
      const t = tasks[i];
      if (t.subject) {
        const validTaskTeacher = t.teacher && isValidTeacherName(t.teacher) ? t.teacher : null;
        const tName = validTaskTeacher || extractTeacherFromSubject(t.subject);
        if (tName && !teacherMap.has(t.subject)) {
          teacherMap.set(t.subject, tName);
        }
      }
    }

    // 2. Group raw graded tasks by subject FIRST so we can detect subject scale
    const rawSubjectGrades = new Map<string, Array<{ task: FullTaskItem; rawGrade: number; maxPoints?: number | null }>>();

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.assignedGrade !== undefined && task.assignedGrade !== null) {
        const list = rawSubjectGrades.get(task.subject) || [];
        list.push({ task, rawGrade: task.assignedGrade, maxPoints: task.maxPoints });
        rawSubjectGrades.set(task.subject, list);
      }
    }

    const allGrades: GradeItem[] = [];
    const subjects: SubjectSummary[] = [];

    let globalCount5 = 0;
    let globalCount4 = 0;
    let globalCount3 = 0;
    let globalCount2 = 0;

    let sumSubjectAverages5 = 0;
    let sumSubjectAverages12 = 0;
    let subjectsWith12Count = 0;

    rawSubjectGrades.forEach((rawGrades, subjectName) => {
      const override = null;
      const { isAuto, activeScale } = detectSubjectScale(rawGrades, override);

      const gradesList: GradeItem[] = [];
      let count5 = 0;
      let count4 = 0;
      let count3 = 0;
      let count2 = 0;

      let sum5 = 0;
      let sum12 = 0;
      let has12 = activeScale === "12";
      let hasCorrected = false;

      for (let i = 0; i < rawGrades.length; i++) {
        const item = rawGrades[i];
        const conv = convertGrade(item.rawGrade, item.maxPoints, { targetScale: activeScale });

        if (conv.isCorrectedScale) {
          hasCorrected = true;
        }

        const gradeItem: GradeItem = {
          id: item.task.id || `task-${item.task.title}-${item.task.subject}`,
          title: item.task.title,
          subject: item.task.subject,
          teacher: item.task.teacher || teacherMap.get(item.task.subject) || null,
          rawGrade: item.rawGrade,
          maxPoints: conv.effectiveMax,
          originalMaxPoints: conv.originalMaxPoints,
          isCorrectedScale: conv.isCorrectedScale,
          grade5: conv.grade5,
          grade12: conv.grade12,
          percentage: conv.percentage,
          date: item.task.dueDateIso,
          url: item.task.url,
        };

        gradesList.push(gradeItem);
        allGrades.push(gradeItem);

        sum5 += conv.grade5;
        sum12 += conv.grade12;
        if (conv.effectiveMax > 5 && conv.effectiveMax <= 12) {
          has12 = true;
        }

        if (conv.grade5 === 5) {
          count5++;
          globalCount5++;
        } else if (conv.grade5 === 4) {
          count4++;
          globalCount4++;
        } else if (conv.grade5 === 3) {
          count3++;
          globalCount3++;
        } else {
          count2++;
          globalCount2++;
        }
      }

      const count = gradesList.length;
      const average5 = count > 0 ? Math.round((sum5 / count) * 100) / 100 : 0;
      const average12 = count > 0 ? Math.round((sum12 / count) * 10) / 10 : null;

      sumSubjectAverages5 += average5;
      if (has12 && average12 !== null) {
        sumSubjectAverages12 += average12;
        subjectsWith12Count++;
      }

      let level: SubjectSummary["level"] = "good";
      if (average5 >= 4.5) level = "excellent";
      else if (average5 >= 3.5) level = "good";
      else if (average5 >= 3.0) level = "satisfactory";
      else level = "risk";

      // Sort grades by date descending
      gradesList.sort((a: GradeItem, b: GradeItem) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      const directTeacher = teacherMap.get(subjectName);
      const validDirectTeacher = directTeacher && isValidTeacherName(directTeacher) ? directTeacher : null;
      const resolvedTeacher =
        validDirectTeacher ||
        getScheduleTeacherForSubject(subjectName) ||
        null;

      subjects.push({
        subject: subjectName,
        teacher: resolvedTeacher,
        grades: gradesList,
        average5,
        average12,
        has12Scale: has12,
        scaleType: activeScale,
        scaleOverride: override,
        isAutoDetectedScale: isAuto,
        hasCorrectedGrades: hasCorrected,
        distribution: { count5, count4, count3, count2 },
        level,
      });
    });

    // Sort subjects alphabetically
    subjects.sort((a: SubjectSummary, b: SubjectSummary) => a.subject.localeCompare(b.subject, "uk"));

    const totalSubjectsCount = subjects.length;
    const totalGradesCount = allGrades.length;

    const overallGpa5 =
      totalSubjectsCount > 0
        ? Math.round((sumSubjectAverages5 / totalSubjectsCount) * 100) / 100
        : 0;

    const overallAverage12 =
      subjectsWith12Count > 0
        ? Math.round((sumSubjectAverages12 / subjectsWith12Count) * 10) / 10
        : null;

    return {
      overallGpa5,
      overallAverage12,
      totalGradesCount,
      totalSubjectsCount,
      distribution: {
        count5: globalCount5,
        count4: globalCount4,
        count3: globalCount3,
        count2: globalCount2,
      },
      subjects,
    };
  }, [tasks]);
}
