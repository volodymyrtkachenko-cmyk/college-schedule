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

export type AcademicEventType = "exam" | "consultation" | "credit" | "defense" | "general";

export interface AcademicEvent {
  id: number;
  group_id: number;
  group_name?: string | null;
  subject_id?: number | null;
  subject_name?: string | null;
  custom_subject?: string | null;
  teacher_id?: number | null;
  teacher_name?: string | null;
  title?: string | null;
  event_type: AcademicEventType;
  event_date: string;
  lesson_number?: number | null;
  start_time: string;
  end_time?: string | null;
  room?: string | null;
  note?: string | null;
}

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

export type LearningMode = "offline" | "online";

export interface LearningModeOverride {
    start: string;
    end: string;
    mode: LearningMode;
    courses: number[];
    reason?: string | null;
}

export interface LearningModeConfig {
    cycle_start: string | null;
    weeks_per_phase: number;
    first_phase_offline_courses: number[];
    overrides: LearningModeOverride[];
}

export interface DirectoryItem {
    id: number;
    name: string;
    disabled?: boolean;
}

export type ReferenceResource = "faculties" | "groups" | "teachers" | "subjects";

export interface ReferenceRecord extends DirectoryItem {
    full_name?: string | null;
    short_name?: string | null;
    faculty_id?: number | null;
    curator_id?: number | null;
    year_of_admission?: number | null;
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
    teacher_room?: string | null;
    second_teacher_room?: string | null;
    subject_name: string;
    teacher_name: string | null;
    week_type: WeekType;
    is_replacement?: boolean;
    is_cancelled?: boolean;
    is_relevant_this_week: boolean;
    group_name?: string;
    note: string | null;
    note_id?: number | null;
    note_revision?: number;
    note_date?: string | null;
    event_type?: string | null;
    event_title?: string | null;
    custom_subject?: string | null;
    event_id?: number | null;
    moved_to_date?: string | null;
    moved_to_lesson?: number | null;
    effective_from?: string | null;
    effective_until?: string | null;
    version_id?: number | null;
    has_template?: boolean;
    is_online?: boolean;
    has_protected_link?: boolean;
}

export interface ShortenedDayItem {
    date: string;
    reason?: string | null;
}

export interface SchedulePeriodInfo {
    id: number;
    name: string;
    period_type: "theory" | "session" | "practice" | "holiday" | "diploma" | "attestation" | string;
    start_date: string;
    end_date: string;
}

export interface ScheduleResponse {
    date: string;
    week_type: WeekType;
    lessons: Lesson[];
    learning_mode?: LearningMode | null;
    learning_mode_override?: LearningModeOverride | null;
    is_shortened_day?: boolean;
    period_info?: SchedulePeriodInfo | null;
}

export interface TemplateDaySchedule {
    day_of_week: number;
    name: string;
    lessons: Lesson[];
}

export interface TemplateScheduleResponse {
    version: ScheduleVersion;
    week_type: WeekType;
    effective_from: string;
    days: TemplateDaySchedule[];
    all_lessons: Lesson[];
}

export interface StatisticsEntry {
    id: number;
    name: string;
    completed_hours: number;
    planned_hours: number | null;
    progress_percent: number | null;
    notes_count?: number;
    cancelled_count?: number;
    replaced_count?: number;
    subject_names?: string[];
}

export interface TeacherSubjectEntry {
    id: number;
    name: string;
    completed_hours: number;
    lessons_count: number;
    groups: string[];
}

export interface TeacherGroupDetail {
    id: number;
    name: string;
    completed_hours: number;
    lessons_count: number;
    subject_names: string[];
}

export interface StatisticsResponse {
    mode: "student" | "teacher";
    semester_start: string;
    through_date: string;
    total_hours: number;
    planned_hours: number | null;
    weekly_hours?: number | null;
    entries: StatisticsEntry[];
    subjects?: TeacherSubjectEntry[] | null;
    groups?: TeacherGroupDetail[] | null;
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
    refresh_token?: string | null;
    token_type: "bearer";
    user: AuthUser;
}

const ADMIN_SESSION_STORAGE_KEY = "schedule:admin_session_data";

function isJwtFresh(token: string | null | undefined, minSecondsRemaining = 60): boolean {
    if (!token || typeof window === "undefined") return false;
    try {
        const parts = token.split(".");
        if (parts.length !== 3) return false;
        const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadJson);
        if (typeof payload.exp !== "number") return false;
        return payload.exp * 1000 - Date.now() > minSecondsRemaining * 1000;
    } catch {
        return false;
    }
}

function loadStoredAdminSession(): { session: AuthSession | null; refreshToken: string | null; isAccessFresh: boolean } {
    if (typeof window === "undefined") return { session: null, refreshToken: null, isAccessFresh: false };
    try {
        const raw = localStorage.getItem(ADMIN_SESSION_STORAGE_KEY);
        if (!raw) return { session: null, refreshToken: null, isAccessFresh: false };
        const parsed = JSON.parse(raw) as AuthSession;
        if (!parsed || !parsed.access_token || !parsed.user) {
            return { session: null, refreshToken: null, isAccessFresh: false };
        }
        return {
            session: parsed,
            refreshToken: parsed.refresh_token ?? null,
            isAccessFresh: isJwtFresh(parsed.access_token, 60),
        };
    } catch {
        return { session: null, refreshToken: null, isAccessFresh: false };
    }
}

function saveStoredAdminSession(session: AuthSession, fallbackRefreshToken?: string | null): void {
    if (typeof window === "undefined") return;
    try {
        const toSave: AuthSession = {
            ...session,
            refresh_token: session.refresh_token ?? fallbackRefreshToken ?? null,
        };
        localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, JSON.stringify(toSave));
        localStorage.setItem("schedule:has_admin_session", "1");
    } catch {}
}

function clearStoredAdminSession(): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
        localStorage.removeItem("schedule:has_admin_session");
    } catch {}
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
    version_id?: number | null;
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

function attachClassroomQueryParams(params: URLSearchParams) {
    if (typeof window !== "undefined") {
        try {
            const cUid = localStorage.getItem("schedule:classroom_google_user_id");
            const cEmail = localStorage.getItem("schedule:classroom_linked_email");
            if (cUid && !params.has("classroom_user_id")) params.set("classroom_user_id", cUid);
            if (cEmail && cEmail !== "підключено" && !params.has("classroom_email")) params.set("classroom_email", cEmail);
            const teacherPin = localStorage.getItem("college_schedule_teacher_pin");
            if (teacherPin && !params.has("teacher_pin")) params.set("teacher_pin", teacherPin);
        } catch {}
    }
}

interface EtagCacheEntry<T = any> {
    etag: string;
    data: T;
}
const etagResponseCache = new Map<string, EtagCacheEntry>();

export function invalidateEtagCache(): void {
    etagResponseCache.clear();
}

async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    // IMPORTANT: build headers via the Headers constructor, not object-spread.
    // `init.headers` may already be a Headers instance (e.g. from request()),
    // and `{...headersInstance}` does NOT copy its entries (Headers doesn't
    // expose them as own enumerable properties) — that previously silently
    // dropped the Authorization header on every authenticated call.
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    if (method !== "GET" && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    if (typeof window !== "undefined") {
        try {
            const teacherPin = localStorage.getItem("college_schedule_teacher_pin");
            if (teacherPin && !headers.has("X-Teacher-Pin")) {
                headers.set("X-Teacher-Pin", teacherPin);
            }
            const classroomUid = localStorage.getItem("schedule_classroom_google_user_id");
            if (classroomUid && !headers.has("X-Classroom-User-Id")) {
                headers.set("X-Classroom-User-Id", classroomUid);
            }
            const classroomEmail = localStorage.getItem("schedule_classroom_linked_email");
            if (classroomEmail && !headers.has("X-Classroom-Email")) {
                headers.set("X-Classroom-Email", classroomEmail);
            }
        } catch {}
    }

    const cachedEtag = method === "GET" ? etagResponseCache.get(path) : undefined;
    if (cachedEtag && !headers.has("If-None-Match")) {
        headers.set("If-None-Match", cachedEtag.etag);
    }

    const timeoutMs = method === "GET" ? 8500 : 15000;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller && !init.signal
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    try {
        const cacheMode = init.cache ?? (method === "GET" ? "no-cache" : "no-store");
        response = await fetch(`${API_URL}${path}`, {
            ...init,
            signal: init.signal ?? controller?.signal,
            cache: cacheMode,
            next: { revalidate: 0 }, // Disable Vercel Data Cache completely
            credentials: "include",
            headers,
        });
    } catch {
        throw new ApiError(0, "Не вдалося з’єднатися із сервером. Перевірте підключення до інтернету та спробуйте ще раз.");
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
    if (response.status === 304 && cachedEtag) {
        return cachedEtag.data as T;
    }
    if (!response.ok) throw new ApiError(response.status, await parseError(response));
    if (response.status === 204) return undefined as T;

    const data = (await response.json()) as T;
    const responseEtag = response.headers?.get ? response.headers.get("ETag") : null;
    if (method === "GET" && responseEtag) {
        etagResponseCache.set(path, { etag: responseEtag, data });
    }
    return data;
}

async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const session = await api.auth.ensureAuthenticated();
    return request<T>(path, init, true, true, session.access_token);
}

async function refresh(): Promise<AuthSession> {
    if (logoutPending) throw new AuthSupersededError();
    if (!refreshPromise) {
        const generation = authGeneration;
        const stored = loadStoredAdminSession();
        const promise = authHttp(async () => {
            assertAuthGeneration(generation);
            const bodyPayload = stored.refreshToken
                ? JSON.stringify({ refresh_token: stored.refreshToken })
                : undefined;
            return rawRequest<AuthSession>("/api/auth/refresh", {
                method: "POST",
                ...(bodyPayload ? { body: bodyPayload } : {}),
            });
        }).then((session) => {
            assertAuthGeneration(generation);
            accessToken = session.access_token;
            currentSession = session;
            saveStoredAdminSession(session, stored.refreshToken);
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
    const stored = loadStoredAdminSession();
    if (stored.session && stored.isAccessFresh) {
        accessToken = stored.session.access_token;
        currentSession = stored.session;
        return currentSession;
    }
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
            saveStoredAdminSession(currentSession);
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
                if (
                    requestGeneration === authGeneration &&
                    !(refreshErr instanceof AuthSupersededError) &&
                    refreshErr instanceof ApiError &&
                    (refreshErr.status === 401 || refreshErr.status === 403)
                ) {
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
    unresolved: { type: string; raw: string; actual_id?: number }[];
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
    is_explicit_substitution?: boolean;
    is_equal_to_base?: boolean;
    change_type?: "substitution" | "swap" | "move" | "none";
    is_swap?: boolean;
    swap_with_lesson?: number | null;
    is_move?: boolean;
    moved_from_lesson?: number | null;
    note?: string | null;
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
    meta?: {
        draft_created?: number | null;
        unchanged?: boolean;
        reason?: string;
        auto_published?: boolean;
        published_id?: number | null;
        anomaly_detected?: boolean;
        is_anomaly?: boolean;
        anomaly_reasons?: string[];
        skipped_reverted?: number;
        skipped_manual?: number;
        out_of_version?: number;
    };
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

export interface GeneratorPriorities {
  teacher_windows: number;
  late_start: number;
  three_consecutive_days: number;
  subject_week_balance: number;
  group_week_balance: number;
  soft_teacher_constraints: number;
}

export interface GeneratorSettings {
  max_time_seconds: number;
  optimization_time_seconds: number;
  hint_mode: "previous" | "fresh";
  priorities: GeneratorPriorities;
}

export interface GeneratorRunOptions {
  max_time_seconds?: number;
  optimization_time_seconds?: number;
  hint_mode?: "previous" | "fresh";
  priorities?: Partial<GeneratorPriorities>;
}

export interface DraftGenerationSummary {
  settings?: GeneratorSettings;
  weights?: Record<string, number>;
  status?: string;
  objective?: number | null;
  elapsed_seconds?: number;
  hints_used?: number;
}

export interface DraftRecord {
  id: number;
  name: string;
  draft_type: "import" | "generated";
  status: string;
  created_at: string;
  revision: number;
  generation?: DraftGenerationSummary | null;

  data?: {
    substitutions?: ImportSubstitution[];
    cancelled?: ImportCancellation[];
    generation?: DraftGenerationSummary;
  } | null;
}

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
  ): Promise<DraftRecord> => {
    const query = max_time !== undefined ? `?max_time_in_seconds=${max_time}` : "";
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
    return request<DraftRecord[]>(`/api/drafts/`, {}, true, true, token);
  },
  getDraft: async (id: number, token: string): Promise<DraftRecord> => {
    return request<DraftRecord>(`/api/drafts/${id}`, {}, true, true, token);
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
  moveSlot: async (slotId: number, day: number, lesson: number, week: string, token: string): Promise<DraftSlotRecord> => {
    return request<DraftSlotRecord>(`/api/drafts/slots/${slotId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ day_of_week: day, lesson_number: lesson, week_type: week })
    }, true, true, token);
  },
  publish: async (
    id: number,
    token: string,
    targetVersionId?: number,
    expectedRevision?: number,
    force?: boolean,
    mode?: "all" | "substitutions_only" | "explicit_only"
  ): Promise<{ status?: string; publication_id?: number | null; message?: string }> => {
    let url = `/api/drafts/${id}/publish?`;
    if (targetVersionId) url += `target_version_id=${targetVersionId}&`;
    if (expectedRevision !== undefined) url += `expected_revision=${expectedRevision}&`;
    if (force) url += `force=true&`;
    if (mode) url += `mode=${mode}&`;
    return request<{ status?: string; publication_id?: number | null; message?: string }>(url, { method: "POST" }, true, true, token);
  },
  updateImportChanges: async (id: number, data: Pick<ImporterReport, "substitutions" | "cancelled">, token: string): Promise<void> => {
    return request<void>(`/api/drafts/${id}/import-changes`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }, true, true, token);
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
      })
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
  }
};

export interface ImportStatusResponse {
  settings: {
    auto_publish: boolean;
    anomaly_group_threshold: number;
    anomaly_total_threshold: number;
  };
  last_publication: {
    id: number;
    timestamp: string;
    source: string;
    changes_count: number;
    is_reverted: boolean;
  } | null;
  last_check?: {
    checked_at: string;
    source: string;
    status: "published" | "unchanged" | "anomaly" | "draft" | "error";
    changes_count: number;
    publication_id?: number | null;
    error_message?: string | null;
  } | null;
  pending_anomaly_draft: {
    id: number;
    name: string;
    changes_count: number;
    anomaly_reasons: string[];
    auto_publish_skipped_reason?: string | null;
    created_at: string | null;
  } | null;
  latest_pending_draft?: {
    id: number;
    name: string;
    changes_count: number;
    is_anomaly: boolean;
    anomaly_reasons: string[];
    auto_publish_skipped_reason?: string | null;
    created_at: string | null;
  } | null;
  anomaly_drafts_count: number;
  active_notification: {
    id: string;
    publication_id: number;
    source: string;
    created_at: string;
    changes_count: number;
    replacements_count?: number;
    swaps_count?: number;
    urgent: boolean;
    dismissed: boolean;
    dates?: string[];
  } | null;
}

export interface PublicationChangeItem {
  group_id: number;
  group_name: string;
  date: string;
  lesson_number: number;
  kind: string;
  change_type?: string;
  is_swap?: boolean;
  before: string;
  after: string;
}

export interface ImportSettingsUpdate {
  auto_publish?: boolean;
  anomaly_group_threshold?: number;
  anomaly_total_threshold?: number;
}

export const apiImporter = {
  importData: async (token?: string): Promise<ImporterResponse> => {
    return request<ImporterResponse>("/api/admin/import", {
      method: "POST"
    }, true, true, token);
  },
  getStatus: async (token?: string): Promise<ImportStatusResponse> => {
    return request<ImportStatusResponse>("/api/admin/import/status", {
      method: "GET"
    }, true, true, token);
  },
  getSettings: async (token?: string): Promise<ImportStatusResponse["settings"]> => {
    return request<ImportStatusResponse["settings"]>("/api/admin/import/settings", {
      method: "GET"
    }, true, true, token);
  },
  updateSettings: async (settings: ImportSettingsUpdate, token?: string): Promise<ImportStatusResponse["settings"]> => {
    return request<ImportStatusResponse["settings"]>("/api/admin/import/settings", {
      method: "PUT",
      body: JSON.stringify(settings)
    }, true, true, token);
  },
  dismissNotification: async (token?: string): Promise<{ status: string }> => {
    return request<{ status: string }>("/api/admin/import/notification/dismiss", {
      method: "POST"
    }, true, true, token);
  },
  bulkCreateAliases: async (aliases: AliasMutation[], token?: string): Promise<{status: string, inserted: number}> => {
    return request<{status: string, inserted: number}>("/api/aliases/bulk", {
      method: "POST",
      body: JSON.stringify(aliases)
    }, true, true, token);
  }
};

export interface OccurrenceNote {
  id: number;
  group_id: number;
  note_date: string;
  lesson_number: number;
  subject_id: number;
  note: string;
  revision: number;
  archived: boolean;
}

export interface NoteRevision {
  note_id: number;
  revision: number;
  event: string;
  snapshot: { note: string; subject_name: string; note_date: string; lesson_number: number; archived: boolean; actor_name?: string | null };
  created_at: string;
}

const GROUP_STATUS_CACHE_TTL = 15000;
const groupStatusCache = new Map<string, { expiresAt: number; promise: Promise<any> }>();

export function invalidateGroupStatusCache(): void {
    groupStatusCache.clear();
}

export const api = {
  publications: {
    list: () => request<any[]>("/api/schedule-versions/publications", { method: "GET" }, true, true),
    revert: (id: number) => request<void>(`/api/schedule-versions/publications/${id}/revert`, { method: "POST" }, true, true),
    changes: (id: number) => request<PublicationChangeItem[]>(`/api/schedule-versions/publications/${id}/changes`, { method: "GET" }, true, true),
  },
  notes: {
    save: (groupId: number, date: string, lessonNumber: number, subjectId: number, note: string, expectedRevision: number) =>
      request<OccurrenceNote>(`/api/lesson-notes/${groupId}/${date}/${lessonNumber}`, {
        method: "PUT", body: JSON.stringify({ subject_id: subjectId, note, expected_revision: expectedRevision }),
      }, true, true),
    remove: (groupId: number, date: string, lessonNumber: number, subjectId: number, expectedRevision: number) =>
      request<void>(`/api/lesson-notes/${groupId}/${date}/${lessonNumber}?subject_id=${subjectId}&expected_revision=${expectedRevision}`, {
        method: "DELETE",
      }, true, true),
    history: (groupId: number, date: string, lessonNumber: number) =>
      request<NoteRevision[]>(`/api/lesson-notes/${groupId}/${date}/${lessonNumber}/history`, { cache: "no-store" }, true, true),
  },
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
            saveStoredAdminSession(session);
            return session;
        },
        getCachedUser: (): AuthUser | null => {
            if (currentSession?.user) return currentSession.user;
            return loadStoredAdminSession().session?.user ?? null;
        },
        refresh, bootstrap, ensureAuthenticated: getSession,
        generation: () => authGeneration,
        isCurrentSession: (session: AuthSession) => currentSession === session,
        clear: () => {
            advanceAuthGeneration();
            accessToken = null;
            currentSession = null;
            clearStoredAdminSession();
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
            true,
            true,
            token,
        ),
        list: (resource: ReferenceResource, token: string) => api.references.request<ReferenceRecord[]>(resource, "GET", token),
        create: (resource: ReferenceResource, payload: ReferenceMutation, token: string) => api.references.request<ReferenceRecord>(resource, "POST", token, payload),
        update: (resource: ReferenceResource, id: number, payload: Partial<ReferenceMutation>, token: string) => api.references.request<ReferenceRecord>(`${resource}/${id}`, "PATCH", token, payload),
        remove: (resource: ReferenceResource, id: number, token: string) => api.references.request<void>(`${resource}/${id}`, "DELETE", token),
    },
    today: (groupId?: number, teacherId?: number, includeCancelled?: boolean) => {
        const params = new URLSearchParams();
        if (groupId) params.set("group_id", String(groupId));
        if (teacherId) params.set("teacher_id", String(teacherId));
        if (includeCancelled) params.set("include_cancelled", "true");
        attachClassroomQueryParams(params);
        return request<ScheduleResponse>(`/api/schedule/today?${params.toString()}`);
    },
    week: (groupId?: number, teacherId?: number, date = new Date(), includeCancelled?: boolean) => {
        const params = new URLSearchParams({ target_date: localDate(date) });
        if (groupId) params.set("group_id", String(groupId));
        if (teacherId) params.set("teacher_id", String(teacherId));
        if (includeCancelled) params.set("include_cancelled", "true");
        attachClassroomQueryParams(params);
        return request<ScheduleResponse[]>(`/api/schedule/week?${params.toString()}`);
    },
    statistics: (target: { groupId?: number; teacherId?: number }) => {
        const params = new URLSearchParams();
        if (target.groupId) params.set("group_id", String(target.groupId));
        if (target.teacherId) params.set("teacher_id", String(target.teacherId));
        return request<StatisticsResponse>(`/api/statistics/?${params.toString()}`);
    },
    educationalProcess: <T = any>(year: number) =>
        request<T>(`/api/educational-process?academic_year_start=${year}`),
    settings: {
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
        getTeacherPin: () =>
            authenticatedRequest<{ pin: string }>("/api/settings/teacher-pin"),
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
        bulkCurator: (payload: {
            day_of_week: number;
            lesson_number: number;
            week_type: WeekType;
            group_ids: number[];
            action: "create" | "delete";
        }) =>
            authenticatedRequest<{ created: number; deleted: number; skipped: number }>(
                "/api/schedule/bulk-curator",
                {
                    method: "POST",
                    body: JSON.stringify(payload),
                }
            ),
    },
    dated: {
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
    },
    template: {
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
    },
    events: {
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
    },
    classroom: {
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
            tokenOrPayload: string | { code?: string; access_token?: string; refresh_token?: string; group_id?: number; week_start?: string },
            groupId?: number
        ) => {
            const body = typeof tokenOrPayload === "string"
                ? { access_token: tokenOrPayload, group_id: groupId }
                : tokenOrPayload;
            return rawRequest<{
                group_id: number;
                group_name: string;
                course_name?: string;
                user_email?: string | null;
                google_user_id?: string | null;
                last_synced_at?: string;
                access_token?: string | null;
                refresh_token?: string | null;
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
        }) =>
            rawRequest<{
                status: string;
                deleted_credentials: number;
                revoked: boolean;
            }>("/api/classroom/disconnect", {
                method: "POST",
                body: JSON.stringify(payload),
            }),
        groupStudents: (groupId: number) =>
            authenticatedRequest<{
                course_name: string | null;
                last_synced_at: string | null;
                connected_accounts_count?: number;
                total_accounts_count?: number;
                has_subgroups?: boolean;
                subgroup_warning?: string | null;
                accounts?: ClassroomAccountStat[];
                students: Array<{ id: number; full_name: string; email?: string | null; photo_url?: string | null }>;
            }>(`/api/classroom/groups/${groupId}/students`),
        bulkImportStudents: (groupId: number, raw_text: string, replace_existing: boolean = false) =>
            authenticatedRequest<{ added: number; total: number }>(
                `/api/classroom/groups/${groupId}/students/bulk`,
                {
                    method: "POST",
                    body: JSON.stringify({ raw_text, replace_existing }),
                }
            ),
        deleteStudent: (groupId: number, studentId: number) =>
            authenticatedRequest<{ status: string }>(
                `/api/classroom/groups/${groupId}/students/${studentId}`,
                {
                    method: "DELETE",
                }
            ),
        deleteCredential: (credId: number) =>
            authenticatedRequest<{ ok: boolean; message: string }>(
                `/api/classroom/credentials/${credId}`,
                {
                    method: "DELETE",
                }
            ),
    },
};
export interface ClassroomAccountStat {
    id: number;
    google_user_id: string;
    email?: string | null;
    student_name?: string | null;
    photo_url?: string | null;
    subgroup?: number | null;
    last_synced_at: string | null;
    last_error: string | null;
    fail_count: number;
    next_attempt_at: string | null;
    is_active: boolean;
}
export interface ClassroomSyncResult {
    group_id: number;
    group_name: string;
    course_name?: string;
    synced_links: number;
    synced_tasks: number;
    synced_students: number;
    unmapped_tasks?: Array<{ title: string; due_date: string | null; reason: string }>;
}
export interface UserResource {
    id: number;
    username: string;
    email: string | null;
    name: string;
    role: "admin" | "editor" | "viewer" | string;
    is_active: boolean;
    allowed_groups: number[];
}

