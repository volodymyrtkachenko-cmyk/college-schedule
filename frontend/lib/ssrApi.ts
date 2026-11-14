import type { PublicBellsResponse, ReferenceRecord, ScheduleResponse } from "./api";
import { BACKEND_API_URL, PROD_API_URL } from "./site";

const PRIMARY_API_URL = BACKEND_API_URL;
const SSR_TIMEOUT_MS = 8500;

export async function fetchSsrJson<T>(
  path: string,
  revalidateSeconds: number = 3600
): Promise<T | null> {
  const fetchOnce = async (baseUrl: string): Promise<{ ok: boolean; status: number; data: T | null }> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SSR_TIMEOUT_MS);
    try {
      const fetchInit: RequestInit & { next?: { revalidate: number } } =
        revalidateSeconds <= 0
          ? { cache: "no-store", signal: controller.signal }
          : { next: { revalidate: revalidateSeconds }, signal: controller.signal };
      const res = await fetch(`${baseUrl}${path}`, fetchInit);
      clearTimeout(timeout);
      if (res.ok) {
        return { ok: true, status: res.status, data: (await res.json()) as T };
      }
      return { ok: false, status: res.status, data: null };
    } catch {
      clearTimeout(timeout);
      return { ok: false, status: 0, data: null };
    }
  };

  const tryFetchWithRetry = async (baseUrl: string): Promise<T | null> => {
    const first = await fetchOnce(baseUrl);
    if (first.ok) return first.data;
    // One lightweight retry on transient cold-start timeout or 5xx
    if (first.status === 0 || first.status >= 500) {
      const second = await fetchOnce(baseUrl);
      if (second.ok) return second.data;
    }
    return null;
  };

  let data = await tryFetchWithRetry(PRIMARY_API_URL);

  if (!data && PRIMARY_API_URL !== PROD_API_URL) {
    data = await tryFetchWithRetry(PROD_API_URL);
  }

  return data;
}

export async function fetchDirectoryForSsr(revalidateSeconds = 3600): Promise<{
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
}> {
  const [groups, teachers] = await Promise.all([
    fetchSsrJson<ReferenceRecord[]>("/api/groups", revalidateSeconds),
    fetchSsrJson<ReferenceRecord[]>("/api/teachers", revalidateSeconds),
  ]);

  const cleanTeachers = (Array.isArray(teachers) ? teachers : []).filter(
    (t) => t.name && !t.name.includes("!") && !t.name.includes(",")
  );

  return {
    groups: Array.isArray(groups) ? groups : [],
    teachers: cleanTeachers,
  };
}

export async function fetchScheduleWeekForSsr(
  params: { groupId?: number; teacherId?: number; targetDateIso?: string }
): Promise<ScheduleResponse[]> {
  const search = new URLSearchParams();
  if (params.groupId) {
    search.set("group_id", String(params.groupId));
  } else if (params.teacherId) {
    search.set("teacher_id", String(params.teacherId));
  } else {
    return [];
  }
  if (params.targetDateIso) {
    search.set("target_date", params.targetDateIso);
  }

  const data = await fetchSsrJson<ScheduleResponse[]>(
    `/api/schedule/week?${search.toString()}`,
    3600
  );

  return Array.isArray(data) ? data : [];
}

export async function fetchBellsForSsr(): Promise<PublicBellsResponse | null> {
  const data = await fetchSsrJson<PublicBellsResponse>("/api/settings/bells", 300);
  if (!data || !Array.isArray(data.standard) || !Array.isArray(data.shortened)) {
    return null;
  }
  return data;
}
