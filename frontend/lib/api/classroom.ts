import {
  attachClassroomQueryParams,
  authenticatedRequest,
  GROUP_STATUS_CACHE_TTL,
  groupStatusCache,
  rawRequest,
} from "./client";
import type {
  ClassroomAccountStat,
  ClassroomCredentialsDiagnosticsResponse,
  ClassroomGroupRosterResponse,
  ClassroomWorkerHeartbeat,
} from "./types";

export interface RawTaskMaterial {
  title: string;
  url?: string | null;
  kind?: string;
}

export interface RawTaskBrief {
  summary: string;
  deliverable?: string | null;
  steps?: string[];
  materials?: Array<string | RawTaskMaterial>;
  estimated_minutes?: number | null;
  work_format?: "phone" | "pc" | "theory" | string;
  source?: "gemini" | "heuristic" | string;
}

export const classroomApi = {
  status: () =>
    rawRequest<{
      has_client_secret: boolean;
      client_id: string;
    }>("/api/classroom/status"),
  groupStatus: (groupId: number) => {
    const params = new URLSearchParams();
    attachClassroomQueryParams(params);
    const qs = params.toString();
    const cacheKey = `${groupId}:${qs}`;
    const cached = groupStatusCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.promise;
    }
    const promise = rawRequest<{
      connected: boolean;
      last_synced_at: string | null;
      has_refresh_token?: boolean;
      has_client_secret?: boolean;
      connected_accounts_count?: number;
      total_accounts_count?: number;
      has_subgroups?: boolean;
      subgroup_warning?: string | null;
      accounts?: ClassroomAccountStat[];
      unmapped_tasks?: Array<{ title: string; due_date: string | null; reason: string }>;
      tasks?: Array<{
        id: string;
        title: string;
        alternate_link?: string;
        url?: string;
        due_date: string | null;
        due_time?: string | null;
        creation_time?: string | null;
        created_at?: string | null;
        course_name: string;
        state: string;
        assigned_grade?: number | null;
        max_points?: number | null;
        brief?: RawTaskBrief | null;
      }>;
      needs_reconnect?: boolean;
      requires_auth?: boolean;
    }>(`/api/classroom/groups/${groupId}/status${qs ? `?${qs}` : ""}`).catch((err) => {
      groupStatusCache.delete(cacheKey);
      throw err;
    });
    groupStatusCache.set(cacheKey, { expiresAt: Date.now() + GROUP_STATUS_CACHE_TTL, promise });
    return promise;
  },
  sync: (
    tokenOrPayload:
      | string
      | {
          code?: string;
          access_token?: string;
          refresh_token?: string;
          session_token?: string;
          google_user_id?: string;
          email?: string;
          group_id?: number;
          week_start?: string;
        },
    groupId?: number,
  ) => {
    let storedSessionToken: string | undefined = undefined;
    if (typeof window !== "undefined") {
      try {
        storedSessionToken = localStorage.getItem("schedule:classroom_session_token") || undefined;
      } catch {}
    }
    const body =
      typeof tokenOrPayload === "string"
        ? { access_token: tokenOrPayload, group_id: groupId, session_token: storedSessionToken }
        : { session_token: storedSessionToken, ...tokenOrPayload };
    return rawRequest<{
      group_id: number;
      group_name: string;
      course_name?: string;
      user_email?: string | null;
      google_user_id?: string | null;
      last_synced_at?: string;
      access_token?: string | null;
      refresh_token?: string | null;
      session_token?: string | null;
      synced_links: number;
      synced_tasks: number;
      synced_students: number;
      unmapped_tasks?: Array<{ title: string; due_date: string | null; reason: string }>;
      tasks?: Array<{
        id: string;
        title: string;
        alternate_link: string;
        due_date: string | null;
        due_time: string | null;
        creation_time: string | null;
        course_name: string;
        state: string;
        assigned_grade?: number | null;
        max_points?: number | null;
        brief?: RawTaskBrief | null;
      }>;
      needs_reconnect?: boolean;
    }>("/api/classroom/sync", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  disconnect: (payload: {
    group_id?: number;
    google_user_id?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
    session_token?: string | null;
  }) =>
    rawRequest<{
      status: string;
      deleted_credentials: number;
      revoked: boolean;
    }>("/api/classroom/disconnect", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  userSubmissions: (payload?: {
    group_id?: number;
    google_user_id?: string | null;
    email?: string | null;
    access_token?: string | null;
    refresh_token?: string | null;
    session_token?: string | null;
  }) => {
    let validLocalAccess: string | undefined = undefined;
    let storedSessionToken: string | undefined = undefined;
    if (typeof window !== "undefined") {
      try {
        const rawTok = localStorage.getItem("schedule:classroom_access_token");
        const rawExp = Number(localStorage.getItem("schedule:classroom_access_token_exp") || "0");
        if (rawTok && rawExp > Date.now()) {
          validLocalAccess = rawTok;
        }
        storedSessionToken = localStorage.getItem("schedule:classroom_session_token") || undefined;
      } catch {}
    }
    const body = {
      group_id: payload?.group_id,
      google_user_id:
        payload?.google_user_id ??
        (typeof window !== "undefined"
          ? localStorage.getItem("schedule:classroom_google_user_id") || undefined
          : undefined),
      email:
        payload?.email ??
        (typeof window !== "undefined"
          ? localStorage.getItem("schedule:classroom_linked_email") || undefined
          : undefined),
      access_token: payload?.access_token ?? validLocalAccess,
      refresh_token: payload?.refresh_token ?? undefined,
      session_token: payload?.session_token ?? storedSessionToken,
    };
    return rawRequest<{
      connected: boolean;
      group_id?: number | null;
      user_email?: string | null;
      google_user_id?: string | null;
      submissions?: Record<string, { state: string; grade?: number | null; maxPoints?: number | null }>;
      tasks?: Array<{
        id: string;
        course_id: string;
        course_name?: string;
        title: string;
        subject?: string;
        teacher?: string | null;
        url: string;
        alternate_link: string;
        state: string;
        grade?: number | null;
        assigned_grade?: number | null;
        max_points?: number | null;
        due_date?: string | null;
        creation_time?: string | null;
        created_at?: string | null;
        brief?: RawTaskBrief | null;
      }>;
      synced_teacher_names?: string[];
      synced_teacher_tokens?: string[];
      synced_subgroups?: number[];
      last_synced_at?: string | null;
      access_token?: string | null;
      session_token?: string | null;
      updated_at?: string;
      needs_relink?: boolean;
      reason_code?: string;
    }>("/api/classroom/user-submissions", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  groupStudents: (groupId: number) =>
    authenticatedRequest<ClassroomGroupRosterResponse>(`/api/classroom/groups/${groupId}/students`),
  syncGroupNow: (groupId: number) =>
    authenticatedRequest<{ ok: boolean } & ClassroomGroupRosterResponse>(
      `/api/classroom/groups/${groupId}/sync-now`,
      {
        method: "POST",
      },
    ),
  bulkImportStudents: (groupId: number, raw_text: string, replace_existing: boolean = false) =>
    authenticatedRequest<{ added: number; total: number }>(
      `/api/classroom/groups/${groupId}/students/bulk`,
      {
        method: "POST",
        body: JSON.stringify({ raw_text, replace_existing }),
      },
    ),
  deleteStudent: (groupId: number, studentId: number) =>
    authenticatedRequest<{ status: string }>(
      `/api/classroom/groups/${groupId}/students/${studentId}`,
      {
        method: "DELETE",
      },
    ),
  deleteCredential: (credId: number) =>
    authenticatedRequest<{ ok: boolean; message: string }>(
      `/api/classroom/credentials/${credId}`,
      {
        method: "DELETE",
      },
    ),
  syncAll: () =>
    authenticatedRequest<{
      checked_groups: number;
      processed: number[];
      errors?: Array<{ group_id: number; error: string }>;
    }>("/api/classroom/sync-all", {
      method: "POST",
    }),
  getDiagnostics: () =>
    authenticatedRequest<ClassroomCredentialsDiagnosticsResponse>(
      "/api/classroom/credentials/diagnostics",
      {
        method: "GET",
      },
    ),
};
