"use client";

export interface ScheduleVersion {
  id: number;
  name: string;
  valid_from: string;
  valid_until: string;
  is_active: boolean;
}

export interface ScheduleVersionMutation {
  name?: string;
  valid_from?: string;
  valid_until?: string;
  is_active?: boolean;
}

export type WeekType = "numerator" | "denominator" | "both";

export interface SemesterStartSetting {
    value: string;
}

export interface SemesterDatesSetting {
    semester_start: string | null;
    semester_end: string | null;
    configured: boolean;
}

export interface SemesterDatesUpdate {
    semester_start: string;
    semester_end: string;
}

export interface DirectoryItem {
    id: number;
    name: string;
    disabled?: boolean;
}

export type ReferenceResource = "faculties" | "groups" | "teachers" | "subjects";

export interface ReferenceRecord extends DirectoryItem {
    short_name?: string | null;
    faculty_id?: number;
    email?: string | null;
    room?: string | null;
  room_override?: string | null;
    is_active: boolean;
    course?: number | null;
}

export type ReferenceMutation = Omit<Partial<ReferenceRecord>, "id" | "is_active"> & { name: string };

export interface Lesson {
    group_id?: number;
    id: number;
    lesson_number: number;
    time: string;
    subject: string;
    subject_id: number;
    teacher_id: number | null;
    second_teacher_id: number | null;
    stream_id?: string | null;
    day_of_week: number;
    teacher: string | null;
    room: string | null;
    room_override?: string | null;
    subject_name: string;
    teacher_name: string | null;
    week_type: WeekType;
    is_replacement?: boolean;
    is_relevant_this_week: boolean;
    group_name?: string;
    note: string | null;
    note_id?: number | null;
    note_date?: string | null;
}

export interface ScheduleResponse {
    date: string;
    week_type: WeekType;
    lessons: Lesson[];
}

export interface StatisticsEntry {
    id: number;
    name: string;
    completed_hours: number;
    planned_hours: number | null;
    progress_percent: number | null;
}

export interface StatisticsResponse {
    mode: "student" | "teacher";
    semester_start: string;
    through_date: string;
    total_hours: number;
    planned_hours: number | null;
    entries: StatisticsEntry[];
}

export interface AuthUser {
    id: number;
    username: string;
    email: string | null;
    name: string;
    role: "admin" | "editor" | "viewer" | string;
    is_active: boolean;
    allowed_groups?: number[];
}

export interface AuthSession {
    access_token: string;
        token_type: "bearer";
    user: AuthUser;
}

export interface LessonMutation {
    group_id?: number;
    date?: string;
    day_of_week?: number;
    subject_id?: number;
    teacher_id?: number | null;
    second_teacher_id?: number | null;
    lesson_number: number;
    subject?: string;
    teacher?: string | null;
    room?: string | null;
  room_override?: string | null;
    week_type: WeekType;
    is_replacement?: boolean;
}

// NEXT_PUBLIC_* values are embedded by Next.js at build time. Keep the
// browser-facing local Docker default explicit so an omitted build arg never
// turns API requests into relative frontend URLs.
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
let accessToken: string | null = null;
let currentSession: AuthSession | null = null;
let authGeneration = 0;
let refreshPromise: Promise<AuthSession> | null = null;
let bootstrapPromise: Promise<AuthSession> | null = null;
let sessionPromise: Promise<AuthSession> | null = null;
// Add after the auth promise declarations in frontend/lib/api.ts.
let authHttpTail: Promise<void> = Promise.resolve();
let logoutPending = false;

export class AuthSupersededError extends Error {
    constructor() {
        super("Auth operation superseded");
        this.name = "AuthSupersededError";
    }
}

function advanceAuthGeneration(): number {
    authGeneration++;
    refreshPromise = null;
    bootstrapPromise = null;
    sessionPromise = null;
    return authGeneration;
}

function assertAuthGeneration(generation: number): void {
    if (generation !== authGeneration) throw new AuthSupersededError();
}

// Serialize cookie-changing operations in this tab. Web Locks also coordinate
// supported same-origin tabs. Browser tests are still required.
function authHttp<T>(operation: () => Promise<T>): Promise<T> {
    const execute = async () => {
        if (typeof navigator !== "undefined" && navigator.locks) {
            return navigator.locks.request("college-schedule-auth", operation);
        }
        return operation();
    };
    const result = authHttpTail.then(execute, execute);
    authHttpTail = result.then(() => undefined, () => undefined);
    return result;
}

const directoryCache = new Map<string, { expiresAt: number; promise: Promise<unknown> }>();
const DIRECTORY_CACHE_TTL = 60_000;

export class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}





function localDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const FIELD_NAMES: Record<string, string> = {
    name: "Назва або ім’я", short_name: "Скорочення", email: "Електронна пошта", room: "Аудиторія",
    username: "Ім’я користувача", password: "Пароль", group_id: "Група", subject_id: "Предмет",
    teacher_id: "Викладач", lesson_number: "Номер пари"
};

async function parseError(response: Response) {
    try {
        const body = await response.json();
        if (response.status >= 500) return "Сталася помилка на сервері. Спробуйте ще раз пізніше.";
        
        if (body.detail && typeof body.detail === "object" && !Array.isArray(body.detail)) {
            const messages: Record<string, string> = {
                active_version_overlap: "Дати перетинаються з іншою активною версією.",
                clone_self: "Не можна клонувати версію в саму себе.",
                clone_target_not_empty: "Цільова версія вже містить заняття. Безпечний перезапис потребує окремого перегляду наслідків.",
                clone_source_empty: "Версія-джерело не містить занять.",
                version_delete_requires_data_policy: "Активну або заповнену версію не можна видалити без окремого захисту даних.",
                version_constraint_conflict: "Зміна суперечить обмеженням версій. Оновіть дані та повторіть перевірку.",
            };
            return typeof body.detail.msg === "string" ? body.detail.msg
                : messages[body.detail.code] ?? "Операцію заблоковано через конфлікт даних.";
        }

        // Custom backend string messages
        if (typeof body.detail === "string") {
            const raw = body.detail.toLowerCase();
            if (raw.includes("unique constraint failed")) {
                if (raw.includes("username")) return "Користувач із таким ім’ям уже існує.";
                if (raw.includes("name")) return "Такий запис уже існує (назва має бути унікальною).";
                return "Запис з такими даними вже існує.";
            }
            if (raw.includes("incorrect username")) return "Неправильний логін або пароль.";
            if (raw.includes("invalid or expired token") || raw.includes("сеанс завершився")) return "Термін дії сеансу завершився. Увійдіть знову.";
            if (raw.includes("draft not found")) return "Чернетку розкладу не знайдено.";
            if (raw.includes("not found") && raw.includes("version")) return "Версію розкладу не знайдено.";
            return body.detail;
        }
        
        // Pydantic validation arrays
        if (body.detail && Array.isArray(body.detail)) {
            const err = body.detail[0];
            const rawField = String(err.loc?.slice(-1)[0] ?? 'Поле');
            const field = FIELD_NAMES[rawField] ?? rawField;
            
            if (err.type.includes('missing')) return `Заповніть поле «${field}».`;
            if (err.type.includes('too_short')) return `Поле «${field}» не може бути порожнім.`;
            if (err.type.includes('string_pattern_mismatch')) return `Перевірте допустимі символи в полі «${field}».`;
            return `Перевірте правильність заповнення поля «${field}».`;
        }
        
        if (response.status >= 500) return "Сталася помилка на сервері. Спробуйте ще раз пізніше.";
        return body.detail ?? "Не вдалося виконати запит. Спробуйте ще раз.";
    } catch {
        return response.status >= 500
            ? "Сталася помилка на сервері. Спробуйте ще раз пізніше."
            : "Не вдалося виконати запит. Спробуйте ще раз.";
    }
}

async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    // IMPORTANT: build headers via the Headers constructor, not object-spread.
    // `init.headers` may already be a Headers instance (e.g. from request()),
    // and `{...headersInstance}` does NOT copy its entries (Headers doesn't
    // expose them as own enumerable properties) — that previously silently
    // dropped the Authorization header on every authenticated call.
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    try {
        response = await fetch(`${API_URL}${path}`, {
            ...init,
            cache: "no-store", // Next.js fetch cache
            next: { revalidate: 0 }, // Disable Vercel Data Cache completely
            credentials: "include",
            headers,
        });
    } catch {
        throw new ApiError(0, "Не вдалося з’єднатися із сервером. Перевірте підключення до інтернету та спробуйте ще раз.");
    }
    if (!response.ok) throw new ApiError(response.status, await parseError(response));
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}

async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = await api.auth.ensureAuthenticated();
    return request<T>(path, init, true, true, session.access_token);
}

async function refresh(): Promise<AuthSession> {
    if (logoutPending) throw new AuthSupersededError();
    if (!refreshPromise) {
        const generation = authGeneration;
        const promise = authHttp(async () => {
            assertAuthGeneration(generation);
            return rawRequest<AuthSession>("/api/auth/refresh", { method: "POST" });
        }).then((session) => {
            assertAuthGeneration(generation);
            accessToken = session.access_token;
            currentSession = session;
            return session;
        }).finally(() => {
            if (refreshPromise === promise) refreshPromise = null;
        });
        refreshPromise = promise;
    }
    return refreshPromise;
}

async function bootstrap(): Promise<AuthSession> {
    if (logoutPending) throw new AuthSupersededError();
    if (currentSession) return currentSession;
    if (!bootstrapPromise) {
        const generation = authGeneration;
        const promise = refresh().then(session => {
            assertAuthGeneration(generation);
            return session;
        }).finally(() => {
            if (bootstrapPromise === promise) bootstrapPromise = null;
        });
        bootstrapPromise = promise;
    }
    return bootstrapPromise;
}

async function getSession(): Promise<AuthSession> {
    if (logoutPending) throw new AuthSupersededError();
    if (!sessionPromise) {
        const generation = authGeneration;
        const promise = bootstrap().then(async session => {
            assertAuthGeneration(generation);
            const user = await rawRequest<AuthUser>("/api/auth/me", {
                headers: { Authorization: "Bearer " + session.access_token },
            });
            assertAuthGeneration(generation);
            currentSession = { ...session, user };
            return currentSession;
        }).finally(() => {
            if (sessionPromise === promise) sessionPromise = null;
        });
        sessionPromise = promise;
    }
    return sessionPromise;
}

async function request<T>(
    path: string,
    init: RequestInit = {},
    retry = true,
    requiresAuth = false,
    authToken?: string,
): Promise<T> {
    const requestGeneration = authGeneration;
    if (requiresAuth && !authToken && !accessToken) {
        authToken = (await bootstrap()).access_token;
    }

    const headers = new Headers(init.headers);
    if (authToken || accessToken) headers.set("Authorization", "Bearer " + (authToken ?? accessToken));
    try {
        return await rawRequest<T>(path, {...init, headers});
    } catch (error) {
        if (requiresAuth && requestGeneration !== authGeneration) throw new AuthSupersededError();
        if (requiresAuth && retry && error instanceof ApiError && error.status === 401) {
            try {
                const session = await refresh();
                return await request<T>(path, init, false, true, session.access_token);
            } catch (refreshErr) {
                if (requestGeneration === authGeneration && !(refreshErr instanceof AuthSupersededError)) {
                    api.auth.clear();
                }
                throw refreshErr;
            }
        }
        throw error;
    }
}

function cachedDirectoryRequest<T>(path: string): Promise<T> {
    const cached = directoryCache.get(path);
    if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;

    const promise = request<T>(path).catch((error) => {
        directoryCache.delete(path);
        throw error;
    });
    directoryCache.set(path, { expiresAt: Date.now() + DIRECTORY_CACHE_TTL, promise });
    return promise;
}

export function invalidateDirectoryCache() {
    directoryCache.clear();
}

export interface CurriculumRecord {
  id: number;
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id: number | null;
  pairs_per_2_weeks: number;
  total_hours: number;
  is_stream: boolean;
  is_fixed: boolean;
  stream_id: string | null;
  strict_day: number | null;
  strict_lesson: number | null;
  require_week: string | null;
  allow_multiple_per_day: boolean;
  group: { id: number, name: string };
  subject: { id: number, name: string };
  teacher: { id: number, name: string; room?: string | null };
  second_teacher: { id: number, name: string; room?: string | null } | null;
}

export interface CurriculumMutation {
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id?: number | null;
  pairs_per_2_weeks: number;
  total_hours: number;
  is_stream: boolean;
  stream_id?: string | null;
  is_fixed: boolean;
  strict_day?: number | null;
  strict_lesson?: number | null;
  require_week?: string | null;
  allow_multiple_per_day?: boolean;
}


export interface ImporterReport {
    unresolved: { type: string; raw: string }[];
    substitutions: ImportSubstitution[];
    cancelled: ImportCancellation[];
    base_slots: any[];
    unresolved_substitutions?: Array<Record<string, unknown>>;
    skipped_base_slots?: Array<Record<string, unknown>>;
    restored_base_slots?: any[];
    debug?: {
        pages_fetched: number;
        unique_page_urls: number;
        unique_page_hashes: number;
        raw_lessons: number;
        raw_base_slots: number;
        raw_substitutions: number;
        raw_cancelled: number;
        deduplicated_base_slots: number;
        deduplicated_substitutions: number;
        deduplicated_cancelled: number;
        filtered_substitutions: number;
        filtered_cancelled: number;
        final_substitutions: number;
        final_cancelled: number;
        page_snapshots: Array<{
            group_id: string | number;
            url: string;
            html_hash: string;
            dates: string[];
            week_type: string;
        }>;
    };
}
export interface ImportSubstitution {
    date: string;
    lesson_number: number;
    group_id: number;
    subject_id: number;
    teacher_id: number;
    second_teacher_id?: number | null;
    room?: string | null;
}
export interface ImportCancellation {
    date: string;
    lesson_number: number;
    group_id: number;
}
export interface ImporterResponse {
    status: string;
    groups_processed: number;
    report: ImporterReport;
    meta?: { draft_created?: number | null; unchanged?: boolean; reason?: string };
}
export interface AliasMutation {
    entity_type: string;
    parsed_name: string;
    actual_id: number;
}

export const apiCurriculums = {
  list: async (token: string, groupId?: number, teacherId?: number): Promise<CurriculumRecord[]> => {
    let url = `/api/curriculums/`;
    const params = new URLSearchParams();
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
    }, false, true, token);
  },
  update: async (id: number, payload: Partial<CurriculumMutation>, token: string): Promise<CurriculumRecord> => {
    return request<CurriculumRecord>(`/api/curriculums/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }, false, true, token);
  },
  remove: async (id: number, token: string): Promise<void> => {
    return request<void>(`/api/curriculums/${id}`, {
      method: "DELETE",
    }, false, true, token);
  }
};

export type SchedulePeriodType = "practice" | "holiday" | "session" | "diploma" | "attestation" | "theory";

export interface SchedulePeriodSlotMutation {
  group_id: number;
  subject_id: number;
  teacher_id: number;
  second_teacher_id?: number | null;
  day_of_week: number;
  lesson_number: number;
  room_override?: string | null;
}

export interface SchedulePeriodSlotRecord extends SchedulePeriodSlotMutation {
  id: number;
  group: DirectoryItem;
  subject: DirectoryItem;
  teacher: DirectoryItem;
  second_teacher: DirectoryItem | null;
}

export interface SchedulePeriodRecord {
  id: number;
  name: string;
  period_type: SchedulePeriodType;
  start_date: string;
  end_date: string;
  groups: DirectoryItem[];
  slots: SchedulePeriodSlotRecord[];
}

export interface SchedulePeriodMutation {
  name: string;
  period_type: SchedulePeriodType;
  start_date: string;
  end_date: string;
  group_ids: number[];
  slots: SchedulePeriodSlotMutation[];
}

export const apiSchedulePeriods = {
  list: (token: string): Promise<SchedulePeriodRecord[]> =>
    request<SchedulePeriodRecord[]>("/api/calendar-periods/", {}, false, true, token),
  create: (payload: SchedulePeriodMutation, token: string): Promise<SchedulePeriodRecord> =>
    request<SchedulePeriodRecord>("/api/calendar-periods/", {
      method: "POST",
      body: JSON.stringify(payload),
    }, false, true, token),
  update: (id: number, payload: SchedulePeriodMutation, token: string): Promise<SchedulePeriodRecord> =>
    request<SchedulePeriodRecord>(`/api/calendar-periods/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }, false, true, token),
  remove: (id: number, token: string): Promise<void> =>
    request<void>(`/api/calendar-periods/${id}`, { method: "DELETE" }, false, true, token),
};

export interface DraftSlotRecord {
  id: number;
  draft_id: number;
  day_of_week: number;
  lesson_number: number;
  week_type: string;
  room_override: string | null;
  curriculum: CurriculumRecord;
}

export interface DraftSubstitutionRecord {
  kind: "substitution" | "cancelled";
  date: string;
  day_of_week: number;
  week_type: string;
  lesson_number: number;
  group_id: number;
  group_name: string | null;
  subject_name: string | null;
  teacher_name: string | null;
  room: string | null;
  teacher_id: number | null;
  second_teacher_id: number | null;
}

export interface DraftRecord {
  id: number;
  name: string;
  draft_type: "import" | "generated";
  status: string;
  created_at: string;
  data?: {
    substitutions?: ImportSubstitution[];
    cancelled?: ImportCancellation[];
  } | null;
}

export const apiGenerator = {
  generate: async (token: string, max_time: number = 600): Promise<DraftRecord> => {
    return request<DraftRecord>(`/api/generator?max_time_in_seconds=${max_time}`, {
      method: "POST",
    }, false, true, token);
  },
  listDrafts: async (token: string): Promise<DraftRecord[]> => {
    return request<DraftRecord[]>(`/api/drafts/`, {}, false, true, token);
  },
  getDraft: async (id: number, token: string): Promise<DraftRecord> => {
    return request<DraftRecord>(`/api/drafts/${id}`, {}, false, true, token);
  },
  deleteDraft: async (id: number, token: string): Promise<void> => {
    return request<void>(`/api/drafts/${id}`, { method: "DELETE" }, false, true, token);
  },
  getSlots: async (id: number, token: string): Promise<DraftSlotRecord[]> => {
    return request<DraftSlotRecord[]>(`/api/drafts/${id}/slots`, {}, false, true, token);
  },
  getSubstitutions: async (id: number, token: string): Promise<DraftSubstitutionRecord[]> => {
    return request<DraftSubstitutionRecord[]>(`/api/drafts/${id}/substitutions`, {}, false, true, token);
  },
  moveSlot: async (slotId: number, day: number, lesson: number, week: string, token: string): Promise<DraftSlotRecord> => {
    return request<DraftSlotRecord>(`/api/drafts/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_of_week: day, lesson_number: lesson, week_type: week })
    }, false, true, token);
  },
  publish: async (id: number, token: string, targetVersionId?: number): Promise<{message: string}> => {
    const url = `/api/drafts/${id}/publish${targetVersionId ? `?target_version_id=${targetVersionId}` : ''}`;
    return request<{message: string}>(url, { method: "POST" }, false, true, token);
  },
  updateImportChanges: async (id: number, data: Pick<ImporterReport, "substitutions" | "cancelled">, token: string): Promise<void> => {
    return request<void>(`/api/drafts/${id}/import-changes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, false, true, token);
  }
};
export interface TeacherConstraintRecord {
  id: number;
  teacher_id: number;
  day_of_week: number;
  lesson_number: number;
  is_hard_constraint: boolean;
  teacher: { id: number; name: string };
}

export const apiConstraints = {
  list: async (token: string, teacherId?: number): Promise<TeacherConstraintRecord[]> => {
    let url = `/api/teacher-constraints/`;
    if (teacherId) url += `?teacher_id=${teacherId}`;
    return request<TeacherConstraintRecord[]>(url, {}, false, true, token);
  },
  create: async (teacherId: number, day: number, lesson: number, token: string): Promise<TeacherConstraintRecord> => {
    return request<TeacherConstraintRecord>(`/api/teacher-constraints/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teacher_id: teacherId, day_of_week: day, lesson_number: lesson, is_hard_constraint: true })
    }, false, true, token);
  },
  remove: async (id: number, token: string): Promise<void> => {
    return request<void>(`/api/teacher-constraints/${id}`, { method: "DELETE" }, false, true, token);
  }
};

export const apiImporter = {
  importData: async (token: string): Promise<ImporterResponse> => {
    return request<ImporterResponse>("/api/admin/import", {
      method: "POST"
    }, false, true, token);
  },
  bulkCreateAliases: async (aliases: AliasMutation[], token: string): Promise<{status: string, inserted: number}> => {
    return request<{status: string, inserted: number}>("/api/aliases/bulk", {
      method: "POST",
      body: JSON.stringify(aliases)
    }, false, true, token);
  }
};

export const api = {
  importer: apiImporter,
  constraints: apiConstraints,
  generator: apiGenerator,
  curriculums: apiCurriculums,
  calendarPeriods: apiSchedulePeriods,
    auth: {
        login: async (username: string, password: string): Promise<AuthSession> => {
            if (logoutPending) throw new Error("Дочекайтеся завершення виходу.");
            const generation = advanceAuthGeneration();
            const session = await authHttp(async () => {
                assertAuthGeneration(generation);
                return rawRequest<AuthSession>("/api/auth/login", {
                    method: "POST",
                    body: JSON.stringify({ username, password }),
                });
            });
            assertAuthGeneration(generation);
            accessToken = session.access_token;
            currentSession = session;
            return session;
        },
        refresh, bootstrap, ensureAuthenticated: getSession,
        generation: () => authGeneration,
        isCurrentSession: (session: AuthSession) => currentSession === session,
        clear: () => {
            advanceAuthGeneration();
            accessToken = null;
            currentSession = null;
        },
        logout: async (): Promise<boolean> => {
            if (logoutPending) throw new Error("Вихід уже виконується.");
            logoutPending = true;
            const generation = advanceAuthGeneration();
            try {
                // Wait for earlier cookie-changing requests before revoking the cookie.
                await authHttp(async () => {
                    assertAuthGeneration(generation);
                    await rawRequest<{status: string}>("/api/auth/logout", { method: "POST" });
                });
                if (generation === authGeneration) api.auth.clear();
                return true;
            } finally {
                logoutPending = false;
            }
        },
    },
    groups: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/groups"),
    directory: {
        faculties: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/faculties"),
        groups: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/groups"),
        subjects: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/subjects"),
        teachers: () => cachedDirectoryRequest<ReferenceRecord[]>("/api/teachers"),
        teacherSubjects: () => cachedDirectoryRequest<Record<number, number[]>>("/api/teacher-subjects"),
        },

    users: {
        list: (token: string) => request<UserResource[]>("/api/admin/users", {}, true, true, token),
        create: (payload: any, token: string) => request<UserResource>("/api/admin/users", { method: "POST", body: JSON.stringify(payload) }, true, true, token),
        update: (id: number, payload: any, token: string) => request<UserResource>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(payload) }, true, true, token),
        remove: (id: number, token: string) => request<void>(`/api/admin/users/${id}`, { method: "DELETE" }, true, true, token),
    },
    references: {
        request: <T>(path: string, method: string, token: string, payload?: unknown) => request<T>(
            `/api/admin/${path}`,
            {
                method,
                body: payload === undefined ? undefined : JSON.stringify(payload),
            },
            false,
            true,
            token,
        ),
        list: (resource: ReferenceResource, token: string) => api.references.request<ReferenceRecord[]>(resource, "GET", token),
        create: (resource: ReferenceResource, payload: ReferenceMutation, token: string) => api.references.request<ReferenceRecord>(resource, "POST", token, payload),
        update: (resource: ReferenceResource, id: number, payload: Partial<ReferenceMutation>, token: string) => api.references.request<ReferenceRecord>(`${resource}/${id}`, "PATCH", token, payload),
        remove: (resource: ReferenceResource, id: number, token: string) => api.references.request<void>(`${resource}/${id}`, "DELETE", token),
    },
    today: (groupId?: number, teacherId?: number) => request<ScheduleResponse>(`/api/schedule/today?${groupId ? `group_id=${groupId}` : `teacher_id=${teacherId}`}`),
    week: (groupId?: number, teacherId?: number, date = new Date()) => {
        const params = new URLSearchParams({ target_date: localDate(date) });
        if (groupId) params.set("group_id", String(groupId));
        if (teacherId) params.set("teacher_id", String(teacherId));
        return request<ScheduleResponse[]>(`/api/schedule/week?${params.toString()}`);
    },
    statistics: (target: { groupId?: number; teacherId?: number }) => {
        const params = new URLSearchParams();
        if (target.groupId) params.set("group_id", String(target.groupId));
        if (target.teacherId) params.set("teacher_id", String(target.teacherId));
        return request<StatisticsResponse>(`/api/statistics/?${params.toString()}`);
    },
    settings: {
        semesterStart: () => request<SemesterStartSetting>("/api/settings/semester-start"),
        semesterDates: () => request<SemesterDatesSetting>("/api/settings/semester-dates"),
        updateSemesterDates: (payload: SemesterDatesUpdate, token: string) =>
            request<SemesterDatesSetting>("/api/settings/semester-dates", {
                method: "PUT",
                body: JSON.stringify(payload),
            }, false, true, token),
    },

    scheduleVersions: {
        list: () => authenticatedRequest<ScheduleVersion[]>("/api/schedule-versions"),
        create: (payload: ScheduleVersionMutation) => authenticatedRequest<ScheduleVersion>("/api/schedule-versions", {
            method: "POST",
            body: JSON.stringify(payload)
        }),
        update: (id: number, payload: ScheduleVersionMutation) => authenticatedRequest<ScheduleVersion>(`/api/schedule-versions/${id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        }),
        remove: (id: number) => authenticatedRequest<void>(`/api/schedule-versions/${id}`, { method: "DELETE" }),
        clone: (id: number, sourceId: number) => authenticatedRequest<{status: string; count: number}>(`/api/schedule-versions/${id}/clone-from/${sourceId}`, { method: "POST" }),
    },
    lessons: {
        create: (payload: LessonMutation) => authenticatedRequest<Lesson>("/api/schedule", {
            method: "POST",
            body: JSON.stringify(payload)
        }),
        update: (id: number, payload: Partial<LessonMutation>) => authenticatedRequest<Lesson>(`/api/schedule/${id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        }),
        remove: (id: number) => authenticatedRequest<void>(`/api/schedule/${id}`, {method: "DELETE"}),
    },
};
export interface UserResource {
    id: number;
    username: string;
    email: string | null;
    name: string;
    role: "admin" | "editor" | "viewer" | string;
    is_active: boolean;
    allowed_groups: number[];
}
