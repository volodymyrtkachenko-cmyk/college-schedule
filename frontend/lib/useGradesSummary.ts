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

export interface GradeItem {
  id: string;
  title: string;
  subject: string;
  teacher?: string | null;
  rawGrade: number;
  maxPoints: number;
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

/**
 * Converts a raw score and maxPoints into Ukrainian 5-point and 12-point scales.
 * Rules:
 * - maxPoints <= 5: 5-point scale task
 * - 5 < maxPoints <= 12: 12-point scale task
 * - maxPoints > 12: 100-point / multi-point task
 */
export function convertGrade(rawGrade: number, maxPointsInput?: number | null): {
  grade5: number;
  grade12: number;
  percentage: number;
  effectiveMax: number;
  isNative12: boolean;
} {
  const effectiveMax =
    maxPointsInput && maxPointsInput > 0
      ? maxPointsInput
      : rawGrade <= 5
      ? 5
      : rawGrade <= 12
      ? 12
      : 100;

  const percentage = Math.min(100, Math.max(0, Math.round((rawGrade / effectiveMax) * 100)));

  let grade5: number;
  let grade12: number;
  let isNative12 = false;

  if (effectiveMax <= 5) {
    // Native 5-point scale
    grade5 = Math.max(1, Math.min(5, Math.round(rawGrade)));
    // Equivalent 12-point
    if (grade5 === 5) grade12 = 12;
    else if (grade5 === 4) grade12 = 9;
    else if (grade5 === 3) grade12 = 6;
    else if (grade5 === 2) grade12 = 3;
    else grade12 = 1;
  } else if (effectiveMax <= 12) {
    // Native 12-point scale
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

  return { grade5, grade12, percentage, effectiveMax, isNative12 };
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

    // 2. Extract graded tasks from Classroom
    const allGrades: GradeItem[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      if (task.assignedGrade !== undefined && task.assignedGrade !== null) {
        const { grade5, grade12, percentage, effectiveMax } = convertGrade(
          task.assignedGrade,
          task.maxPoints
        );
        allGrades.push({
          id: task.id || `task-${task.title}-${task.subject}`,
          title: task.title,
          subject: task.subject,
          teacher: task.teacher || teacherMap.get(task.subject) || null,
          rawGrade: task.assignedGrade,
          maxPoints: effectiveMax,
          grade5,
          grade12,
          percentage,
          date: task.dueDateIso,
          url: task.url,
        });
      }
    }

    // 3. Group by subject
    const subjectMap = new Map<string, GradeItem[]>();

    for (let i = 0; i < allGrades.length; i++) {
      const g = allGrades[i];
      const list = subjectMap.get(g.subject) || [];
      list.push(g);
      subjectMap.set(g.subject, list);
    }

    let globalCount5 = 0;
    let globalCount4 = 0;
    let globalCount3 = 0;
    let globalCount2 = 0;

    const subjects: SubjectSummary[] = [];
    let sumSubjectAverages5 = 0;
    let sumSubjectAverages12 = 0;
    let subjectsWith12Count = 0;

    subjectMap.forEach((gradesList, subjectName) => {
      let count5 = 0;
      let count4 = 0;
      let count3 = 0;
      let count2 = 0;

      let sum5 = 0;
      let sum12 = 0;
      let has12 = false;

      for (let i = 0; i < gradesList.length; i++) {
        const g = gradesList[i];
        sum5 += g.grade5;
        sum12 += g.grade12;
        if (g.maxPoints > 5 && g.maxPoints <= 12) {
          has12 = true;
        }

        if (g.grade5 === 5) {
          count5++;
          globalCount5++;
        } else if (g.grade5 === 4) {
          count4++;
          globalCount4++;
        } else if (g.grade5 === 3) {
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
        distribution: { count5, count4, count3, count2 },
        level,
      });
    });

    // Sort subjects alphabetically or by lowest/highest grade
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
