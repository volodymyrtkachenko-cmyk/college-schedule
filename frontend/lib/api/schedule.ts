import { getSyncedNow } from "../date";
import {
  attachClassroomQueryParams,
  authenticatedRequest,
  localDate,
  rawRequest,
  request,
} from "./client";
import type {
  AcademicEvent,
  LearningModeConfig,
  Lesson,
  LessonMutation,
  NoteRevision,
  OccurrenceNote,
  PublicationChangeItem,
  ScheduleResponse,
  ScheduleVersion,
  ScheduleVersionMutation,
  SemesterDatesSetting,
  SemesterDatesUpdate,
  SemesterStartSetting,
  ShortenedDayItem,
  StatisticsResponse,
  TemplateScheduleResponse,
  WeekType,
} from "./types";

export const publicationsApi = {
  list: () => request<any[]>("/api/schedule-versions/publications", { method: "GET" }, true, true),
  revert: (id: number) =>
    request<void>(`/api/schedule-versions/publications/${id}/revert`, { method: "POST" }, true, true),
  changes: (id: number) =>
    request<PublicationChangeItem[]>(`/api/schedule-versions/publications/${id}/changes`, { method: "GET" }, true, true),
};

export const notesApi = {
  save: (groupId: number, date: string, lessonNumber: number, subjectId: number, note: string, expectedRevision: number) =>
    request<OccurrenceNote>(`/api/lesson-notes/${groupId}/${date}/${lessonNumber}`, {
      method: "PUT",
      body: JSON.stringify({ subject_id: subjectId, note, expected_revision: expectedRevision }),
    }, true, true),
  remove: (groupId: number, date: string, lessonNumber: number, subjectId: number, expectedRevision: number) =>
    request<void>(
      `/api/lesson-notes/${groupId}/${date}/${lessonNumber}?subject_id=${subjectId}&expected_revision=${expectedRevision}`,
      { method: "DELETE" },
      true,
      true,
    ),
  history: (groupId: number, date: string, lessonNumber: number) =>
    request<NoteRevision[]>(`/api/lesson-notes/${groupId}/${date}/${lessonNumber}/history`, { cache: "no-store" }, true, true),
};

export function today(groupId?: number, teacherId?: number, includeCancelled?: boolean) {
  const params = new URLSearchParams();
  if (groupId) params.set("group_id", String(groupId));
  if (teacherId) params.set("teacher_id", String(teacherId));
  if (includeCancelled) params.set("include_cancelled", "true");
  attachClassroomQueryParams(params);
  return request<ScheduleResponse>(`/api/schedule/today?${params.toString()}`);
}

export function week(groupId?: number, teacherId?: number, date = getSyncedNow(), includeCancelled?: boolean) {
  const params = new URLSearchParams({ target_date: localDate(date) });
  if (groupId) params.set("group_id", String(groupId));
  if (teacherId) params.set("teacher_id", String(teacherId));
  if (includeCancelled) params.set("include_cancelled", "true");
  attachClassroomQueryParams(params);
  return request<ScheduleResponse[]>(`/api/schedule/week?${params.toString()}`);
}

export function statistics(target: { groupId?: number; teacherId?: number }) {
  const params = new URLSearchParams();
  if (target.groupId) params.set("group_id", String(target.groupId));
  if (target.teacherId) params.set("teacher_id", String(target.teacherId));
  return request<StatisticsResponse>(`/api/statistics/?${params.toString()}`);
}

export function educationalProcess<T = any>(year: number) {
  return request<T>(`/api/educational-process?academic_year_start=${year}`);
}

export const settingsApi = {
  semesterStart: () => request<SemesterStartSetting>("/api/settings/semester-start"),
  learningMode: () => request<LearningModeConfig>("/api/settings/learning-mode"),
  updateLearningMode: (payload: LearningModeConfig, token: string) =>
    request<LearningModeConfig>("/api/settings/learning-mode", {
      method: "PUT",
      body: JSON.stringify(payload),
    }, true, true, token),
  semesterDates: () => request<SemesterDatesSetting>("/api/settings/semester-dates"),
  updateSemesterDates: (payload: SemesterDatesUpdate, token: string) =>
    request<SemesterDatesSetting>("/api/settings/semester-dates", {
      method: "PUT",
      body: JSON.stringify(payload),
    }, true, true, token),
  verifyTeacherPin: (pin: string) =>
    rawRequest<{ valid: boolean }>("/api/settings/verify-teacher-pin", {
      method: "POST",
      body: JSON.stringify({ pin }),
    }),
  getTeacherPin: () => authenticatedRequest<{ pin: string }>("/api/settings/teacher-pin"),
  updateTeacherPin: (pin: string) =>
    authenticatedRequest<{ pin: string }>("/api/settings/teacher-pin", {
      method: "PUT",
      body: JSON.stringify({ pin }),
    }),
  shortenedDays: {
    list: () => request<ShortenedDayItem[]>("/api/settings/shortened-days"),
    add: (item: ShortenedDayItem, token: string) =>
      request<ShortenedDayItem[]>("/api/settings/shortened-days", {
        method: "POST",
        body: JSON.stringify(item),
      }, true, true, token),
    delete: (dateStr: string, token: string) =>
      request<ShortenedDayItem[]>(`/api/settings/shortened-days/${dateStr}`, {
        method: "DELETE",
      }, true, true, token),
    toggle: (dateStr: string, token: string, reason?: string) =>
      request<{ date: string; is_shortened: boolean }>("/api/settings/shortened-days/toggle", {
        method: "POST",
        body: JSON.stringify({ date: dateStr, reason }),
      }, true, true, token),
  },
};

export const scheduleVersionsApi = {
  list: () => authenticatedRequest<ScheduleVersion[]>("/api/schedule-versions"),
  create: (payload: ScheduleVersionMutation) =>
    authenticatedRequest<ScheduleVersion>("/api/schedule-versions", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: number, payload: ScheduleVersionMutation) =>
    authenticatedRequest<ScheduleVersion>(`/api/schedule-versions/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: number, force: boolean = true) =>
    authenticatedRequest<void>(`/api/schedule-versions/${id}${force ? "?force=true" : ""}`, { method: "DELETE" }),
  clearSchedule: (id: number) =>
    authenticatedRequest<{ status: string; count: number }>(`/api/schedule-versions/${id}/clear-schedule`, {
      method: "POST",
    }),
  clone: (id: number, sourceId: number, overwrite: boolean = false) =>
    authenticatedRequest<{ status: string; count: number }>(
      `/api/schedule-versions/${id}/clone-from/${sourceId}${overwrite ? "?overwrite=true" : ""}`,
      { method: "POST" },
    ),
};

export const lessonsApi = {
  create: (payload: LessonMutation) =>
    authenticatedRequest<Lesson>("/api/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: number, payload: Partial<LessonMutation>) =>
    authenticatedRequest<Lesson>(`/api/schedule/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: number) => authenticatedRequest<void>(`/api/schedule/${id}`, { method: "DELETE" }),
  bulkCurator: (payload: {
    day_of_week: number;
    lesson_number: number;
    week_type: WeekType;
    group_ids: number[];
    action: "create" | "delete";
  }) =>
    authenticatedRequest<{ created: number; deleted: number; skipped: number }>("/api/schedule/bulk-curator", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export const datedApi = {
  cancel: (payload: { group_id: number; date: string; lesson_number: number }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/cancel", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  restore: (payload: { group_id: number; date: string; lesson_number: number }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/restore", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  replace: (payload: {
    group_id: number;
    date: string;
    lesson_number: number;
    subject_id?: number | null;
    teacher_id?: number | null;
    second_teacher_id?: number | null;
    room?: string | null;
    stream_id?: string | null;
  }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/replace", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  move: (payload: {
    source_group_id: number;
    source_date: string;
    source_lesson_number: number;
    target_group_id: number;
    target_date: string;
    target_lesson_number: number;
    expected_note_revision?: number | null;
  }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/move", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  removeReplacement: (payload: { group_id: number; date: string; lesson_number: number }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/remove-replacement", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  copy: (payload: {
    source_group_id: number;
    source_date: string;
    source_lesson_number: number;
    target_group_id: number;
    target_date: string;
    target_lesson_number: number;
  }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/copy", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  swap: (payload: {
    first_group_id: number;
    first_date: string;
    first_lesson_number: number;
    second_group_id: number;
    second_date: string;
    second_lesson_number: number;
  }) =>
    authenticatedRequest<{ status: string }>("/api/schedule/dated/swap", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  batch: (payload: {
    action: "copy" | "move";
    items: Array<{
      source_group_id: number;
      source_date: string;
      source_lesson_number: number;
      target_group_id: number;
      target_date: string;
      target_lesson_number: number;
    }>;
    skip_conflicts?: boolean;
  }) =>
    authenticatedRequest<{
      status: string;
      action: string;
      total: number;
      succeeded: number;
    }>("/api/schedule/dated/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export const templateApi = {
  get: (params: {
    version_id: number;
    group_id?: number;
    teacher_id?: number;
    week_type?: string;
    effective_date?: string;
  }) => {
    const qs = new URLSearchParams({ version_id: String(params.version_id) });
    if (params.group_id) qs.set("group_id", String(params.group_id));
    if (params.teacher_id) qs.set("teacher_id", String(params.teacher_id));
    if (params.week_type) qs.set("week_type", params.week_type);
    if (params.effective_date) qs.set("effective_date", params.effective_date);
    return authenticatedRequest<TemplateScheduleResponse>(`/api/schedule/template?${qs.toString()}`);
  },
  createLesson: (payload: LessonMutation) =>
    authenticatedRequest<{ lesson: Lesson; affected_dates: string[] }>("/api/schedule/template/lesson", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateLesson: (id: number, payload: LessonMutation) =>
    authenticatedRequest<{ lesson: Lesson; affected_dates: string[] }>(`/api/schedule/template/lesson/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteLesson: (id: number) =>
    authenticatedRequest<{ status: string; affected_dates: string[] }>(`/api/schedule/template/lesson/${id}`, {
      method: "DELETE",
    }),
  copy: (payload: {
    version_id: number;
    source_lesson_id: number;
    target_day_of_week: number;
    target_lesson_number: number;
    target_week_type: string;
  }) =>
    authenticatedRequest<{ lesson: Lesson; affected_dates: string[] }>("/api/schedule/template/copy", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  move: (payload: {
    version_id: number;
    source_lesson_id: number;
    target_day_of_week: number;
    target_lesson_number: number;
    target_week_type: string;
  }) =>
    authenticatedRequest<{ lesson: Lesson; affected_dates: string[] }>("/api/schedule/template/move", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  swap: (payload: {
    version_id: number;
    first_lesson_id: number;
    second_lesson_id: number;
  }) =>
    authenticatedRequest<{ status: string; affected_dates: string[] }>("/api/schedule/template/swap", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  dayAction: (payload: {
    action: "copy" | "move";
    version_id: number;
    group_id: number;
    source_day_of_week: number;
    source_week_type: string;
    target_day_of_week: number;
    target_week_type: string;
  }) =>
    authenticatedRequest<{ status: string; count: number; affected_dates: string[] }>("/api/schedule/template/day-action", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

export const eventsApi = {
  list: (params: { group_id?: number; teacher_id?: number; from_date?: string }) => {
    const qs = new URLSearchParams();
    if (params.group_id) qs.set("group_id", String(params.group_id));
    if (params.teacher_id) qs.set("teacher_id", String(params.teacher_id));
    if (params.from_date) qs.set("from_date", params.from_date);
    return request<AcademicEvent[]>(`/api/events?${qs.toString()}`);
  },
  create: (payload: Omit<AcademicEvent, "id" | "group_name" | "subject_name" | "teacher_name">) =>
    authenticatedRequest<AcademicEvent>("/api/events", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  update: (id: number, payload: Partial<Omit<AcademicEvent, "id" | "group_name" | "subject_name" | "teacher_name">>) =>
    authenticatedRequest<AcademicEvent>(`/api/events/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  remove: (id: number) =>
    authenticatedRequest<{ status: string }>(`/api/events/${id}`, {
      method: "DELETE",
    }),
};
