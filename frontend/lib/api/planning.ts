import { cachedDirectoryRequest, request } from "./client";
import type {
  AcademicTermMutation,
  AcademicTermRecord,
  AliasMutation,
  CurriculumDeduplicateResult,
  CurriculumMutation,
  CurriculumRecord,
  DraftRecord,
  DraftSlotRecord,
  DraftSubstitutionRecord,
  GeneratorRunOptions,
  GeneratorSettings,
  ImporterReport,
  ImporterResponse,
  ImportSettingsUpdate,
  ImportStatusResponse,
  ReferenceMutation,
  ReferenceRecord,
  ReferenceResource,
  SchedulePeriodMutation,
  SchedulePeriodRecord,
  TeacherConstraintRecord,
  UserResource,
  WorkloadCalculationResult,
} from "./types";

export const apiTerms = {
  list: async (): Promise<AcademicTermRecord[]> => {
    return request<AcademicTermRecord[]>(`/api/terms`, {}, false, false);
  },
  active: async (): Promise<AcademicTermRecord> => {
    return request<AcademicTermRecord>(`/api/terms/active`, {}, false, false);
  },
  get: async (id: number): Promise<AcademicTermRecord> => {
    return request<AcademicTermRecord>(`/api/terms/${id}`, {}, false, false);
  },
  create: async (payload: AcademicTermMutation, token: string): Promise<AcademicTermRecord> => {
    return request<AcademicTermRecord>(`/api/terms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, true, true, token);
  },
  update: async (id: number, payload: AcademicTermMutation, token: string): Promise<AcademicTermRecord> => {
    return request<AcademicTermRecord>(`/api/terms/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, true, true, token);
  },
  clone: async (
    id: number,
    sourceTermId: number,
    recalculateHours: boolean,
    token: string,
  ): Promise<{ message: string; cloned_curriculums: number; cloned_constraints: number }> => {
    return request(`/api/terms/${id}/clone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source_term_id: sourceTermId, recalculate_hours: recalculateHours }),
    }, true, true, token);
  },
  calculate: async (
    course: number,
    options: { termId?: number; totalHours?: number; pairsPer2Weeks?: number },
  ): Promise<WorkloadCalculationResult> => {
    const params = new URLSearchParams();
    params.append("course", course.toString());
    if (options.termId) params.append("term_id", options.termId.toString());
    if (options.totalHours !== undefined) params.append("total_hours", options.totalHours.toString());
    if (options.pairsPer2Weeks !== undefined) params.append("pairs_per_2_weeks", options.pairsPer2Weeks.toString());
    return request<WorkloadCalculationResult>(`/api/terms/calculate?${params.toString()}`, {}, false, false);
  },
};

export const apiCurriculums = {
  list: async (token: string, groupId?: number, teacherId?: number, termId?: number): Promise<CurriculumRecord[]> => {
    let url = `/api/curriculums/`;
    const params = new URLSearchParams();
    if (termId) params.append("term_id", termId.toString());
    if (groupId) params.append("group_id", groupId.toString());
    if (teacherId) params.append("teacher_id", teacherId.toString());
    if (params.toString()) url += `?${params.toString()}`;
    return request<CurriculumRecord[]>(url, {}, false, true, token);
  },
  create: async (payload: CurriculumMutation, token: string): Promise<CurriculumRecord> => {
    return request<CurriculumRecord>(`/api/curriculums/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, true, true, token);
  },
  update: async (id: number, payload: Partial<CurriculumMutation>, token: string): Promise<CurriculumRecord> => {
    return request<CurriculumRecord>(`/api/curriculums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, true, true, token);
  },
  remove: async (id: number, token: string): Promise<void> => {
    return request<void>(`/api/curriculums/${id}`, {
      method: "DELETE",
    }, true, true, token);
  },
  deduplicate: async (token: string): Promise<CurriculumDeduplicateResult> => {
    return request<CurriculumDeduplicateResult>(`/api/curriculums/deduplicate`, {
      method: "POST",
    }, true, true, token);
  },
};

export const apiSchedulePeriods = {
  list: (token: string): Promise<SchedulePeriodRecord[]> =>
    request<SchedulePeriodRecord[]>("/api/calendar-periods/", {}, true, true, token),
  create: (payload: SchedulePeriodMutation, token: string): Promise<SchedulePeriodRecord> =>
    request<SchedulePeriodRecord>("/api/calendar-periods/", {
      method: "POST",
      body: JSON.stringify(payload),
    }, true, true, token),
  update: (id: number, payload: SchedulePeriodMutation, token: string): Promise<SchedulePeriodRecord> =>
    request<SchedulePeriodRecord>(`/api/calendar-periods/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }, true, true, token),
  remove: (id: number, token: string): Promise<void> =>
    request<void>(`/api/calendar-periods/${id}`, { method: "DELETE" }, true, true, token),
};

export const apiGenerator = {
  getSettings: async (token: string): Promise<GeneratorSettings> => {
    return request<GeneratorSettings>(`/api/generator/settings`, {}, true, true, token);
  },
  updateSettings: async (settings: GeneratorSettings, token: string): Promise<GeneratorSettings> => {
    return request<GeneratorSettings>(`/api/generator/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    }, true, true, token);
  },
  generate: async (
    token: string,
    max_time?: number,
    options?: GeneratorRunOptions,
    termId?: number,
  ): Promise<DraftRecord> => {
    const params = new URLSearchParams();
    if (max_time !== undefined) params.append("max_time_in_seconds", String(max_time));
    if (termId !== undefined) params.append("term_id", String(termId));
    const query = params.toString() ? `?${params.toString()}` : "";
    return request<DraftRecord>(`/api/generator${query}`, {
      method: "POST",
      ...(options
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(options),
          }
        : {}),
    }, true, true, token);
  },
  listDrafts: async (token: string): Promise<DraftRecord[]> => {
    return request<DraftRecord[]>(`/api/drafts/`, { cache: "no-store" }, true, true, token);
  },
  getDraft: async (id: number, token: string): Promise<DraftRecord> => {
    return request<DraftRecord>(`/api/drafts/${id}`, { cache: "no-store" }, true, true, token);
  },
  deleteDraft: async (id: number, token: string): Promise<void> => {
    return request<void>(`/api/drafts/${id}`, { method: "DELETE" }, true, true, token);
  },
  getSlots: async (id: number, token: string): Promise<DraftSlotRecord[]> => {
    return request<DraftSlotRecord[]>(`/api/drafts/${id}/slots`, {}, true, true, token);
  },
  getSubstitutions: async (id: number, token: string): Promise<DraftSubstitutionRecord[]> => {
    return request<DraftSubstitutionRecord[]>(`/api/drafts/${id}/substitutions`, {}, true, true, token);
  },
  moveSlot: async (
    slotId: number,
    day: number,
    lesson: number,
    week: string,
    token: string,
  ): Promise<DraftSlotRecord> => {
    return request<DraftSlotRecord>(`/api/drafts/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_of_week: day, lesson_number: lesson, week_type: week }),
    }, true, true, token);
  },
  swapSlots: async (
    slotAId: number,
    slotBId: number,
    weekType: "numerator" | "denominator",
    token: string,
  ): Promise<DraftSlotRecord[]> => {
    return request<DraftSlotRecord[]>(`/api/drafts/slots/swap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot_a_id: slotAId, slot_b_id: slotBId, week_type: weekType }),
    }, true, true, token);
  },
  lockSlot: async (slotId: number, isLocked: boolean, token: string): Promise<DraftSlotRecord> => {
    return request<DraftSlotRecord>(`/api/drafts/slots/${slotId}/lock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_locked: isLocked }),
    }, true, true, token);
  },
  publish: async (
    id: number,
    token: string,
    targetVersionId?: number,
    expectedRevision?: number,
    force?: boolean,
    mode?: "all" | "substitutions_only" | "explicit_only",
  ): Promise<{ status?: string; publication_id?: number | null; message?: string }> => {
    let url = `/api/drafts/${id}/publish?`;
    if (targetVersionId) url += `target_version_id=${targetVersionId}&`;
    if (expectedRevision !== undefined) url += `expected_revision=${expectedRevision}&`;
    if (force) url += `force=true&`;
    if (mode) url += `mode=${mode}&`;
    return request<{ status?: string; publication_id?: number | null; message?: string }>(
      url,
      { method: "POST" },
      true,
      true,
      token,
    );
  },
  updateImportChanges: async (
    id: number,
    data: Pick<ImporterReport, "substitutions" | "cancelled">,
    token: string,
  ): Promise<void> => {
    return request<void>(`/api/drafts/${id}/import-changes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, true, true, token);
  },
};

export const apiConstraints = {
  list: async (token: string, teacherId?: number): Promise<TeacherConstraintRecord[]> => {
    let url = `/api/teacher-constraints/`;
    if (teacherId) url += `?teacher_id=${teacherId}`;
    return request<TeacherConstraintRecord[]>(url, {}, true, true, token);
  },
  create: async (
    teacherId: number,
    day: number,
    lesson: number,
    token: string,
    isHardConstraint: boolean = true,
  ): Promise<TeacherConstraintRecord> => {
    return request<TeacherConstraintRecord>(`/api/teacher-constraints/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teacher_id: teacherId,
        day_of_week: day,
        lesson_number: lesson,
        is_hard_constraint: isHardConstraint,
      }),
    }, true, true, token);
  },
  update: async (
    id: number,
    data: { is_hard_constraint?: boolean },
    token: string,
  ): Promise<TeacherConstraintRecord> => {
    return request<TeacherConstraintRecord>(`/api/teacher-constraints/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, true, true, token);
  },
  remove: async (id: number, token: string): Promise<void> => {
    return request<void>(`/api/teacher-constraints/${id}`, { method: "DELETE" }, true, true, token);
  },
};

export const apiImporter = {
  importData: async (token?: string, weeks: number = 1): Promise<ImporterResponse> => {
    return request<ImporterResponse>(`/api/admin/import?weeks=${weeks}`, {
      method: "POST",
    }, true, true, token);
  },
  getStatus: async (token?: string): Promise<ImportStatusResponse> => {
    return request<ImportStatusResponse>("/api/admin/import/status", {
      method: "GET",
    }, true, true, token);
  },
  getSettings: async (token?: string): Promise<ImportStatusResponse["settings"]> => {
    return request<ImportStatusResponse["settings"]>("/api/admin/import/settings", {
      method: "GET",
    }, true, true, token);
  },
  updateSettings: async (
    settings: ImportSettingsUpdate,
    token?: string,
  ): Promise<ImportStatusResponse["settings"]> => {
    return request<ImportStatusResponse["settings"]>("/api/admin/import/settings", {
      method: "PUT",
      body: JSON.stringify(settings),
    }, true, true, token);
  },
  dismissNotification: async (token?: string): Promise<{ status: string }> => {
    return request<{ status: string }>("/api/admin/import/notification/dismiss", {
      method: "POST",
    }, true, true, token);
  },
  bulkCreateAliases: async (
    aliases: AliasMutation[],
    token?: string,
  ): Promise<{ status: string; inserted: number }> => {
    return request<{ status: string; inserted: number }>("/api/aliases/bulk", {
      method: "POST",
      body: JSON.stringify(aliases),
    }, true, true, token);
  },
};

export const groupsDirectory = () => cachedDirectoryRequest<ReferenceRecord[]>("/api/groups");

export const directoryApi = {
  faculties: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/faculties"),
  groups: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/groups"),
  subjects: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/subjects"),
  teachers: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/teachers"),
  teacherSubjects: () => cachedDirectoryRequest<Record<number, number[]>>("/api/teacher-subjects"),
};

export const usersApi = {
  list: (token: string) => request<UserResource[]>("/api/admin/users", {}, true, true, token),
  create: (payload: any, token: string) =>
    request<UserResource>("/api/admin/users", { method: "POST", body: JSON.stringify(payload) }, true, true, token),
  update: (id: number, payload: any, token: string) =>
    request<UserResource>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, true, true, token),
  remove: (id: number, token: string) =>
    request<void>(`/api/admin/users/${id}`, { method: "DELETE" }, true, true, token),
};

export const referencesApi = {
  request: <T>(path: string, method: string, token: string, payload?: unknown) =>
    request<T>(
      `/api/admin/${path}`,
      {
        method,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      },
      true,
      true,
      token,
    ),
  list: (resource: ReferenceResource, token: string) =>
    referencesApi.request<ReferenceRecord[]>(resource, "GET", token),
  create: (resource: ReferenceResource, payload: ReferenceMutation, token: string) =>
    referencesApi.request<ReferenceRecord>(resource, "POST", token, payload),
  update: (resource: ReferenceResource, id: number, payload: Partial<ReferenceMutation>, token: string) =>
    referencesApi.request<ReferenceRecord>(`${resource}/${id}`, "PATCH", token, payload),
  remove: (resource: ReferenceResource, id: number, token: string) =>
    referencesApi.request<void>(`${resource}/${id}`, "DELETE", token),
};
