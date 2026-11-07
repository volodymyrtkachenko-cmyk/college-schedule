import type { ReferenceRecord, ScheduleResponse } from "./api";

const PROD_API_URL = "https://backend-agile-driftwood-8589.fly.dev";
const PRIMARY_API_URL = process.env.NEXT_PUBLIC_API_URL || PROD_API_URL;

export async function fetchSsrJson<T>(
  path: string,
  revalidateSeconds: number = 3600
): Promise<T | null> {
  const tryFetch = async (baseUrl: string) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        next: { revalidate: revalidateSeconds },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) {
        return (await res.json()) as T;
      }
      return null;
    } catch {
      clearTimeout(timeout);
      return null;
    }
  };

  // 1. Спроба за первинною адресою
  let data = await tryFetch(PRIMARY_API_URL);

  // 2. Якщо первинна адреса (наприклад, локальна IP) не відповідає, перемикаємось на робочий продакшн бекенд
  if (!data && PRIMARY_API_URL !== PROD_API_URL) {
    data = await tryFetch(PROD_API_URL);
  }

  return data;
}

export async function fetchDirectoryForSsr(): Promise<{
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
}> {
  const [groups, teachers] = await Promise.all([
    fetchSsrJson<ReferenceRecord[]>("/api/groups", 3600),
    fetchSsrJson<ReferenceRecord[]>("/api/teachers", 3600),
  ]);

  const cleanTeachers = (Array.isArray(teachers) ? teachers : []).filter(
    (t) => t.name && !t.name.includes("!")
  );

  return {
    groups: Array.isArray(groups) ? groups : [],
    teachers: cleanTeachers,
  };
}

export async function fetchScheduleWeekForSsr(
  params: { groupId?: number; teacherId?: number }
): Promise<ScheduleResponse[]> {
  const query = params.groupId
    ? `group_id=${params.groupId}`
    : params.teacherId
    ? `teacher_id=${params.teacherId}`
    : "";
  if (!query) return [];

  const data = await fetchSsrJson<ScheduleResponse[]>(
    `/api/schedule/week?${query}`,
    3600
  );

  return Array.isArray(data) ? data : [];
}
