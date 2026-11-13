import { getSyncedNow } from "../date";
import type { AuthSession } from "./types";

const ADMIN_SESSION_STORAGE_KEY = "schedule:admin_session_data";

export function isJwtFresh(token: string | null | undefined, minSecondsRemaining = 60): boolean {
  if (!token || typeof window === "undefined") return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const payloadJson = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    const payload = JSON.parse(payloadJson);
    if (typeof payload.exp !== "number") return false;
    return payload.exp * 1000 - getSyncedNow().getTime() > minSecondsRemaining * 1000;
  } catch {
    return false;
  }
}

export function loadStoredAdminSession(): {
  session: AuthSession | null;
  refreshToken: string | null;
  isAccessFresh: boolean;
} {
  if (typeof window === "undefined") {
    return { session: null, refreshToken: null, isAccessFresh: false };
  }
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

export function saveStoredAdminSession(session: AuthSession, fallbackRefreshToken?: string | null): void {
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

export function clearStoredAdminSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    localStorage.removeItem("schedule:has_admin_session");
  } catch {}
}
