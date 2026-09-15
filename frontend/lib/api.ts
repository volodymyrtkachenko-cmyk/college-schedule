"use client";

export type WeekType = "numerator" | "denominator" | "both";

export interface SemesterStartSetting {
    value: string;
}

export interface DirectoryItem {
    id: number;
    name: string;
}

export type ReferenceResource = "faculties" | "groups" | "teachers" | "rooms" | "subjects";

export interface ReferenceRecord extends DirectoryItem {
    short_name?: string | null;
    faculty_id?: number;
    email?: string | null;
    building?: string | null;
    capacity?: number | null;
    is_active: boolean;
}

export type ReferenceMutation = Omit<Partial<ReferenceRecord>, "id" | "is_active"> & { name: string };

export interface Lesson {
    id: number;
    lesson_number: number;
    time: string;
    subject: string;
    subject_id: number;
    teacher_id: number | null;
    room_id: number | null;
    day_of_week: number;
    teacher: string | null;
    room: string | null;
    subject_name: string;
    teacher_name: string | null;
    room_name: string | null;
    week_type: WeekType;
    is_relevant_this_week: boolean;
    note: string | null;
    note_id?: number | null;
    note_date?: string | null;
}

export interface LessonNote {
    id: number;
    schedule_id: number;
    note_date: string;
    note: string;
}

export interface LessonNoteMutation {
    schedule_id: number;
    note_date: string;
    note: string;
}

export interface ScheduleResponse {
    date: string;
    week_type: WeekType;
    lessons: Lesson[];
}

export interface AuthUser {
    id: number;
    username: string;
    email: string | null;
    name: string;
    role: "admin" | "editor" | "viewer" | string;
    is_active: boolean;
}

export interface AuthSession {
    access_token: string;
    refresh_token: string;
    token_type: "bearer";
    user: AuthUser;
}

export interface LessonMutation {
    group_id: number;
    date?: string;
    day_of_week?: number;
    subject_id?: number;
    teacher_id?: number | null;
    room_id?: number | null;
    lesson_number: number;
    start_time: string;
    end_time: string;
    subject?: string;
    teacher?: string | null;
    room?: string | null;
    week_type: WeekType;
}

// NEXT_PUBLIC_* values are embedded by Next.js at build time. Keep the
// browser-facing local Docker default explicit so an omitted build arg never
// turns API requests into relative frontend URLs.
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");
let accessToken: string | null = null;
let refreshToken: string | null = null;
let currentSession: AuthSession | null = null;
let refreshPromise: Promise<AuthSession> | null = null;
let bootstrapPromise: Promise<AuthSession> | null = null;
let sessionPromise: Promise<AuthSession> | null = null;

class ApiError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

const refreshStorageKey = "college_schedule_refresh_token";

function storedRefreshToken() {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem(refreshStorageKey);
}

function rememberRefreshToken(token: string) {
    if (typeof window !== "undefined") window.sessionStorage.setItem(refreshStorageKey, token);
}

function forgetRefreshToken() {
    if (typeof window !== "undefined") window.sessionStorage.removeItem(refreshStorageKey);
}

function localDate(date: Date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function parseError(response: Response) {
    try {
        const body = await response.json() as { detail?: string };
        return body.detail ?? `API request failed (${response.status})`;
    } catch {
        return `API request failed (${response.status})`;
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
            cache: "no-store",
            credentials: "include",
            headers,
        });
    } catch {
        throw new ApiError(0, `Не вдалося підключитися до API (${API_URL}). Перевірте, що backend запущено на порту 8000.`);
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
    if (!refreshPromise) {
        const token = refreshToken ?? storedRefreshToken();
        if (token) refreshToken = token;
        refreshPromise = rawRequest<AuthSession>("/api/auth/refresh", {
            method: "POST",
            body: token ? JSON.stringify({refresh_token: token}) : undefined
        })
            .then((session) => {
                accessToken = session.access_token;
                refreshToken = session.refresh_token;
                rememberRefreshToken(session.refresh_token);
                currentSession = session;
                return session;
            })
            .finally(() => {
                refreshPromise = null;
            });
    }
    return refreshPromise;
}

async function bootstrap(): Promise<AuthSession> {
    if (currentSession) return currentSession;
    if (!bootstrapPromise) {
        bootstrapPromise = refresh().finally(() => {
            bootstrapPromise = null;
        });
    }
    return bootstrapPromise;
}

async function getSession(): Promise<AuthSession> {
    if (!sessionPromise) {
        sessionPromise = bootstrap()
            .then(async (session) => {
                const user = await rawRequest<AuthUser>("/api/auth/me", {
                    headers: {Authorization: "Bearer " + session.access_token},
                });
                currentSession = {...session, user};
                return currentSession;
            })
            .finally(() => {
                sessionPromise = null;
            });
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
    if (requiresAuth && !authToken && !accessToken) {
        authToken = (await bootstrap()).access_token;
    }
    const headers = new Headers(init.headers);
    if (authToken || accessToken) headers.set("Authorization", "Bearer " + (authToken ?? accessToken));
    try {
        return await rawRequest<T>(path, {...init, headers});
    } catch (error) {
        if (requiresAuth && retry && error instanceof ApiError && error.status === 401) {
            const session = await refresh();
            return request<T>(path, init, false, true, session.access_token);
        }
        throw error;
    }
}

export const api = {
    auth: {
        login: async (username: string, password: string) => {
            const session = await rawRequest<AuthSession>("/api/auth/login", {
                method: "POST",
                body: JSON.stringify({username, password})
            });
            accessToken = session.access_token;
            refreshToken = session.refresh_token;
            rememberRefreshToken(session.refresh_token);
            currentSession = session;
            return session;
        },
        refresh, bootstrap, ensureAuthenticated: getSession, clear: () => {
            accessToken = null;
            refreshToken = null;
            currentSession = null;
            bootstrapPromise = null;
            sessionPromise = null;
            forgetRefreshToken();
        },
    },
    groups: () => request<DirectoryItem[]>("/api/groups"),
    directory: {
        faculties: () => request<ReferenceRecord[]>("/api/faculties", {}, true, true),
        subjects: () => request<ReferenceRecord[]>("/api/subjects", {}, true, true),
        teachers: () => request<ReferenceRecord[]>("/api/teachers", {}, true, true),
        rooms: () => request<ReferenceRecord[]>("/api/rooms", {}, true, true),
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
    today: (groupId: number) => request<ScheduleResponse>(`/api/schedule/today?group_id=${groupId}`),
    week: (groupId: number, date = new Date()) => request<ScheduleResponse[]>(`/api/schedule/week?group_id=${groupId}&target_date=${localDate(date)}`),
    settings: {semesterStart: () => request<SemesterStartSetting>("/api/settings/semester-start")},
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
    notes: {
        list: (scheduleId: number, noteDate: string) => request<LessonNote[]>(`/api/lesson-notes?schedule_id=${scheduleId}&note_date=${encodeURIComponent(noteDate)}`),
        create: (payload: LessonNoteMutation) => authenticatedRequest<LessonNote>("/api/lesson-notes", {
            method: "POST",
            body: JSON.stringify(payload)
        }),
        update: (id: number, payload: Partial<LessonNoteMutation>) => authenticatedRequest<LessonNote>(`/api/lesson-notes/${id}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
        }),
        remove: (id: number) => authenticatedRequest<void>(`/api/lesson-notes/${id}`, {method: "DELETE"}),
    },
};