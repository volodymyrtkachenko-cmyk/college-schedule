"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, AuthUser, AuthSupersededError } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const generation = api.auth.generation();
    api.auth.ensureAuthenticated()
      .then((session) => {
        if (mounted && generation === api.auth.generation() && api.auth.isCurrentSession(session)) setUser(session.user);
      })
      .catch((e) => {
        if (mounted && generation === api.auth.generation() && !(e instanceof AuthSupersededError)) {
          setUser(null);
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  async function login(username: string, password: string) {
    const session = await api.auth.login(username, password);
    if (!api.auth.isCurrentSession(session)) throw new AuthSupersededError();
    setUser(session.user);
  }

  useEffect(() => {
    const receiveLogout = () => {
      api.auth.clear();
      setUser(null);
      window.location.href = "/login";
    };
    let channel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel("auth_sync");
        channel.onmessage = event => {
          if (event.data === "logout") receiveLogout();
        };
      }
    } catch { /* Storage-event fallback below. */ }
    const onStorage = (event: StorageEvent) => {
      if (event.key === "college-schedule:logout" && event.newValue) receiveLogout();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      channel?.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  async function logout() {
    let success = false;
    try {
      success = await api.auth.logout();
    } catch (e) {
      console.error("Logout error", e);
    }
    
    if (success) {
      try {
        if (typeof BroadcastChannel !== "undefined") {
            const channel = new BroadcastChannel("auth_sync");
            channel.postMessage("logout");
            channel.close();
        }
      } catch (e) {
        console.warn("BroadcastChannel not supported", e);
      }
      try {
        localStorage.setItem("college-schedule:logout", `${Date.now()}:${Math.random()}`);
      } catch { /* Storage may be disabled. */ }
      setUser(null);
      window.location.href = "/login";
    } else {
      throw new Error("Не вдалося вийти з системи. Сервер недоступний.");
    }
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

export function canAccessAdmin(user: AuthUser | null) {
  return user?.role === "admin" || user?.role === "editor";
}
