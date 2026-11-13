import { updateServerTimeOffset } from "../date";
import {
  clearStoredAdminSession,
  isJwtFresh,
  loadStoredAdminSession,
  saveStoredAdminSession,
} from "./authStorage";
import { ApiError, AuthSupersededError, parseApiError } from "./errors";
import type { AuthSession, AuthUser } from "./types";

// NEXT_PUBLIC_* values are embedded by Next.js at build time. Keep the
// production Heroku backend default explicit so an omitted build arg never
// turns API requests into broken relative frontend URLs or stale hosts.
const DEFAULT_API_URL = "https://my-college-schedule-api-8ffebe58b2b9.herokuapp.com";
const API_URL = process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL;

let accessToken: string | null = null;
let currentSession: AuthSession | null = null;
let authGeneration = 0;
let refreshPromise: Promise<AuthSession> | null = null;
let bootstrapPromise: Promise<AuthSession> | null = null;
let sessionPromise: Promise<AuthSession> | null = null;
let authHttpTail: Promise<void> = Promise.resolve();
let logoutPending = false;

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

interface EtagCacheEntry<T = any> {
  etag: string;
  data: T;
}
const etagResponseCache = new Map<string, EtagCacheEntry>();

export function invalidateEtagCache(): void {
  etagResponseCache.clear();
}

export function invalidateDirectoryCache(): void {
  directoryCache.clear();
}

export const GROUP_STATUS_CACHE_TTL = 15000;
export const groupStatusCache = new Map<string, { expiresAt: number; promise: Promise<any> }>();

export function invalidateGroupStatusCache(): void {
  groupStatusCache.clear();
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function attachClassroomQueryParams(params: URLSearchParams): void {
  if (typeof window !== "undefined") {
    try {
      const cUid = localStorage.getItem("schedule:classroom_google_user_id");
      const cEmail = localStorage.getItem("schedule:classroom_linked_email");
      if (cUid && !params.has("classroom_user_id")) params.set("classroom_user_id", cUid);
      if (cEmail && cEmail !== "підключено" && !params.has("classroom_email")) {
        params.set("classroom_email", cEmail);
      }
      const teacherPin = localStorage.getItem("college_schedule_teacher_pin");
      if (teacherPin && !params.has("teacher_pin")) params.set("teacher_pin", teacherPin);
    } catch {}
  }
}

export async function rawRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  // Build headers via Headers constructor so existing Headers instances preserve Authorization.
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
      const classroomUid = localStorage.getItem("schedule:classroom_google_user_id");
      if (classroomUid && !headers.has("X-Classroom-User-Id")) {
        headers.set("X-Classroom-User-Id", classroomUid);
      }
      const classroomEmail = localStorage.getItem("schedule:classroom_linked_email");
      if (classroomEmail && !headers.has("X-Classroom-Email")) {
        headers.set("X-Classroom-Email", classroomEmail);
      }
    } catch {}
  }

  const cachedEtag = method === "GET" ? etagResponseCache.get(path) : undefined;
  if (cachedEtag && !headers.has("If-None-Match")) {
    headers.set("If-None-Match", cachedEtag.etag);
  }

  const defaultTimeout = method === "GET" ? 8500 : 15000;
  const timeoutMs = (init as any).timeoutMs ?? (path.includes("/admin/import") ? 90000 : defaultTimeout);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller && !init.signal ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const cacheMode = init.cache ?? (method === "GET" ? "no-cache" : "no-store");
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: init.signal ?? controller?.signal,
      cache: cacheMode,
      next: { revalidate: 0 },
      credentials: "include",
      headers,
    });
  } catch {
    throw new ApiError(0, "Не вдалося з’єднатися із сервером. Перевірте підключення до інтернету та спробуйте ще раз.");
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  updateServerTimeOffset(response.headers?.get ? response.headers.get("Date") : null);
  if (response.status === 304 && cachedEtag) {
    return cachedEtag.data as T;
  }
  if (!response.ok) throw new ApiError(response.status, await parseApiError(response));
  if (response.status === 204) return undefined as T;

  const data = (await response.json()) as T;
  const responseEtag = response.headers?.get ? response.headers.get("ETag") : null;
  if (method === "GET" && responseEtag) {
    etagResponseCache.set(path, { etag: responseEtag, data });
  }
  return data;
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
    })
      .then((session) => {
        assertAuthGeneration(generation);
        accessToken = session.access_token;
        currentSession = session;
        saveStoredAdminSession(session, stored.refreshToken);
        return session;
      })
      .catch((err) => {
        if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
          if (generation === authGeneration) {
            authApi.clear();
          }
        }
        throw err;
      })
      .finally(() => {
        if (refreshPromise === promise) refreshPromise = null;
      });
    refreshPromise = promise;
  }
  return refreshPromise;
}

async function bootstrap(): Promise<AuthSession> {
  if (logoutPending) throw new AuthSupersededError();
  if (currentSession) {
    if (!isJwtFresh(currentSession.access_token, 2 * 86400)) {
      refresh().catch(() => {});
    }
    return currentSession;
  }
  const stored = loadStoredAdminSession();
  if (stored.session && stored.isAccessFresh) {
    accessToken = stored.session.access_token;
    currentSession = stored.session;
    if (!isJwtFresh(accessToken, 2 * 86400)) {
      refresh().catch(() => {});
    }
    return currentSession;
  }
  if (!bootstrapPromise) {
    const generation = authGeneration;
    const promise = refresh()
      .then((session) => {
        assertAuthGeneration(generation);
        return session;
      })
      .finally(() => {
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
    const promise = bootstrap()
      .then(async (session) => {
        assertAuthGeneration(generation);
        const user = await rawRequest<AuthUser>("/api/auth/me", {
          headers: { Authorization: "Bearer " + session.access_token },
        });
        assertAuthGeneration(generation);
        currentSession = { ...session, user };
        saveStoredAdminSession(currentSession);
        return currentSession;
      })
      .finally(() => {
        if (sessionPromise === promise) sessionPromise = null;
      });
    sessionPromise = promise;
  }
  return sessionPromise;
}

export async function request<T>(
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
    return await rawRequest<T>(path, { ...init, headers });
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
          authApi.clear();
        }
        throw refreshErr;
      }
    }
    throw error;
  }
}

export async function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = await authApi.ensureAuthenticated();
  return request<T>(path, init, true, true, session.access_token);
}

export function cachedDirectoryRequest<T>(path: string): Promise<T> {
  const cached = directoryCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.promise as Promise<T>;

  const promise = request<T>(path).catch((error) => {
    directoryCache.delete(path);
    throw error;
  });
  directoryCache.set(path, { expiresAt: Date.now() + DIRECTORY_CACHE_TTL, promise });
  return promise;
}

export const authApi = {
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
    if (currentSession?.user && isJwtFresh(currentSession.access_token, 5)) return currentSession.user;
    const stored = loadStoredAdminSession();
    return stored.session && stored.isAccessFresh ? stored.session.user : null;
  },
  hasValidAccessToken: (): boolean => Boolean(accessToken && isJwtFresh(accessToken, 5)),
  refresh,
  bootstrap,
  ensureAuthenticated: getSession,
  maybeSilentRefresh: async (): Promise<void> => {
    if (logoutPending) return;
    const token = currentSession?.access_token || loadStoredAdminSession().session?.access_token;
    if (!token) return;
    if (!isJwtFresh(token, 2 * 86400)) {
      await refresh().catch(() => {});
    }
  },
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
      const stored = loadStoredAdminSession();
      const tokenToRevoke = accessToken || stored.session?.access_token;
      const refreshTokenToRevoke = stored.refreshToken;
      const headers = new Headers();
      if (tokenToRevoke) {
        headers.set("Authorization", "Bearer " + tokenToRevoke);
      }
      const bodyPayload = refreshTokenToRevoke
        ? JSON.stringify({ refresh_token: refreshTokenToRevoke })
        : undefined;

      // Wait for earlier cookie-changing requests before revoking the cookie.
      await authHttp(async () => {
        assertAuthGeneration(generation);
        await rawRequest<{ status: string }>("/api/auth/logout", {
          method: "POST",
          headers,
          ...(bodyPayload ? { body: bodyPayload } : {}),
        });
      });
      if (generation === authGeneration) authApi.clear();
      return true;
    } finally {
      logoutPending = false;
    }
  },
};
