import { ClassroomTaskItem } from "./taskDeadlines";

export function groupDualTeacherTasks(
  items: ClassroomTaskItem[],
  secondaryItems: { name: string; displayName: string }[],
  effectiveSubgroup: number | null
): { teacher: string | null; items: ClassroomTaskItem[] }[] {
  if (items.length === 0) return [];
  if (!secondaryItems || secondaryItems.length < 2) {
    return [{ teacher: null, items }];
  }

  const s0 = secondaryItems[0]?.name ? secondaryItems[0].name.split(/[\s.]+/)[0].trim().toLowerCase() : "";
  const s1 = secondaryItems[1]?.name ? secondaryItems[1].name.split(/[\s.]+/)[0].trim().toLowerCase() : "";

  const matchItem = (t: ClassroomTaskItem, surname: string, subNum: number): boolean => {
    const tTeacher = (t.teacher || "").trim().toLowerCase();
    if (tTeacher) {
      if (surname && (tTeacher.includes(surname) || surname.includes(tTeacher))) return true;
      if (
        tTeacher.includes(`${subNum} підгр`) ||
        tTeacher.includes(`підгрупа ${subNum}`) ||
        tTeacher.includes(`підгр. ${subNum}`) ||
        tTeacher === `${subNum}` ||
        tTeacher === `${subNum} підгрупа`
      ) {
        return true;
      }
    }
    const tTitle = (t.title || "").toLowerCase();
    if (surname && tTitle.includes(surname)) return true;
    if (tTitle.includes(`(${subNum} підгр`) || tTitle.includes(`[${subNum} підгр`)) return true;
    return false;
  };

  const g0: ClassroomTaskItem[] = [];
  const g1: ClassroomTaskItem[] = [];
  const others: ClassroomTaskItem[] = [];

  for (const t of items) {
    const m0 = matchItem(t, s0, 1);
    const m1 = matchItem(t, s1, 2);
    if (m0 && !m1) {
      g0.push(t);
    } else if (m1 && !m0) {
      g1.push(t);
    } else {
      others.push(t);
    }
  }

  const label0 = /підгр/i.test(secondaryItems[0].displayName)
    ? secondaryItems[0].displayName
    : `${secondaryItems[0].displayName} (1 підгр.)`;
  const label1 = /підгр/i.test(secondaryItems[1].displayName)
    ? secondaryItems[1].displayName
    : `${secondaryItems[1].displayName} (2 підгр.)`;

  const res: { teacher: string | null; items: ClassroomTaskItem[] }[] = [];

  const first = effectiveSubgroup === 2 ? { label: label1, list: g1 } : { label: label0, list: g0 };
  const second = effectiveSubgroup === 2 ? { label: label0, list: g0 } : { label: label1, list: g1 };

  if (first.list.length > 0) {
    res.push({ teacher: first.label, items: first.list });
  }
  if (second.list.length > 0) {
    res.push({ teacher: second.label, items: second.list });
  }

  if (others.length > 0) {
    if (res.length === 0) {
      return [{ teacher: null, items: others }];
    }
    res.push({ teacher: "Інші завдання", items: others });
  }

  return res.length > 0 ? res : [{ teacher: null, items }];
}
