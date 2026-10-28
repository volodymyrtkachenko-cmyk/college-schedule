"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { FullTaskItem } from "../components/MobileTasksView";

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
  isManual?: boolean;
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
  standing: {
    title: string;
    description: string;
    badgeColor: "emerald" | "blue" | "amber" | "rose";
  };
  customGrades: CustomGrade[];
  addCustomGrade: (grade: Omit<CustomGrade, "id">) => void;
  removeCustomGrade: (id: string) => void;
}

export interface CustomGrade {
  id: string;
  subject: string;
  title: string;
  grade: number;
  maxScale: 5 | 12;
  date: string;
}

const CUSTOM_GRADES_STORAGE_KEY = "schedule:custom_grades";

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

export function useGradesSummary(tasks: FullTaskItem[]): GradesSummaryResult {
  const [customGrades, setCustomGrades] = useState<CustomGrade[]>([]);

  // Load custom grades from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = localStorage.getItem(CUSTOM_GRADES_STORAGE_KEY);
      if (stored) {
        setCustomGrades(JSON.parse(stored));
      }
    } catch {}
  }, []);

  const addCustomGrade = useCallback((newGrade: Omit<CustomGrade, "id">) => {
    const item: CustomGrade = {
      ...newGrade,
      id: "manual-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
    };
    setCustomGrades((prev) => {
      const updated = [item, ...prev];
      try {
        localStorage.setItem(CUSTOM_GRADES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  const removeCustomGrade = useCallback((id: string) => {
    setCustomGrades((prev) => {
      const updated = prev.filter((g) => g.id !== id);
      try {
        localStorage.setItem(CUSTOM_GRADES_STORAGE_KEY, JSON.stringify(updated));
      } catch {}
      return updated;
    });
  }, []);

  return useMemo(() => {
    // 1. Extract graded tasks from Classroom
    const classroomGraded: GradeItem[] = [];

    for (const task of tasks) {
      if (task.assignedGrade !== undefined && task.assignedGrade !== null) {
        const { grade5, grade12, percentage, effectiveMax } = convertGrade(
          task.assignedGrade,
          task.maxPoints
        );
        classroomGraded.push({
          id: task.id || `task-${task.title}-${task.subject}`,
          title: task.title,
          subject: task.subject,
          teacher: task.teacher,
          rawGrade: task.assignedGrade,
          maxPoints: effectiveMax,
          grade5,
          grade12,
          percentage,
          date: task.dueDateIso,
          url: task.url,
          isManual: false,
        });
      }
    }

    // 2. Add custom grades
    const manualGraded: GradeItem[] = customGrades.map((cg) => {
      const { grade5, grade12, percentage, effectiveMax } = convertGrade(
        cg.grade,
        cg.maxScale
      );
      return {
        id: cg.id,
        title: cg.title,
        subject: cg.subject,
        rawGrade: cg.grade,
        maxPoints: effectiveMax,
        grade5,
        grade12,
        percentage,
        date: cg.date,
        isManual: true,
      };
    });

    const allGrades = [...classroomGraded, ...manualGraded];

    // 3. Group by subject
    const subjectMap = new Map<string, GradeItem[]>();
    const teacherMap = new Map<string, string | null | undefined>();

    for (const g of allGrades) {
      const list = subjectMap.get(g.subject) || [];
      list.push(g);
      subjectMap.set(g.subject, list);
      if (g.teacher && !teacherMap.has(g.subject)) {
        teacherMap.set(g.subject, g.teacher);
      }
    }

    let globalCount5 = 0;
    let globalCount4 = 0;
    let globalCount3 = 0;
    let globalCount2 = 0;

    const subjects: SubjectSummary[] = [];
    let sumSubjectAverages5 = 0;
    let sumSubjectAverages12 = 0;
    let subjectsWith12Count = 0;

    for (const [subjectName, gradesList] of subjectMap.entries()) {
      let count5 = 0;
      let count4 = 0;
      let count3 = 0;
      let count2 = 0;

      let sum5 = 0;
      let sum12 = 0;
      let has12 = false;

      for (const g of gradesList) {
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
      gradesList.sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      subjects.push({
        subject: subjectName,
        teacher: teacherMap.get(subjectName) || null,
        grades: gradesList,
        average5,
        average12,
        has12Scale: has12,
        distribution: { count5, count4, count3, count2 },
        level,
      });
    }

    // Sort subjects alphabetically or by lowest/highest grade
    subjects.sort((a, b) => a.subject.localeCompare(b.subject, "uk"));

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

    let standing: GradesSummaryResult["standing"] = {
      title: "Немає оцінок",
      description: "Оцінки з'являться після того, як викладачі виставлять їх у Google Classroom.",
      badgeColor: "blue",
    };

    if (totalGradesCount > 0) {
      if (overallGpa5 >= 4.75 && globalCount3 === 0 && globalCount2 === 0) {
        standing = {
          title: "Відмінник · Претендент на підвищену стипендію",
          description: "Винятковий середній бал! Усі предмети складено на «відмінно».",
          badgeColor: "emerald",
        };
      } else if (overallGpa5 >= 4.0 && globalCount2 === 0) {
        standing = {
          title: "Стипендіальний рівень",
          description: "Гарний академічний результат, достатній для отримання стипендії.",
          badgeColor: "blue",
        };
      } else if (overallGpa5 >= 3.0 && globalCount2 === 0) {
        standing = {
          title: "Задовільний рівень",
          description: "Боргів немає, але варто підтягнути окремі предмети для підвищення рейтингу.",
          badgeColor: "amber",
        };
      } else {
        standing = {
          title: "Потребує уваги · Є заборгованості",
          description: "Зверніть увагу на незадовільні оцінки та зверніться до викладачів для перездачі.",
          badgeColor: "rose",
        };
      }
    }

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
      standing,
      customGrades,
      addCustomGrade,
      removeCustomGrade,
    };
  }, [tasks, customGrades, addCustomGrade, removeCustomGrade]);
}
