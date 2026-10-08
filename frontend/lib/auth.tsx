"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, AuthUser } from "./api";

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
    api.auth.ensureAuthenticated()
      .then((session) => {
        if (mounted) setUser(session.user);
      })
      .catch((e) => {
        if (mounted && !e.message?.includes("Auth generation changed") && !e.message?.includes("superseded")) {
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
    setUser(session.user);
  }

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("auth_sync");
    channel.onmessage = (e) => {
      if (e.data === "logout") {
        api.auth.clear();
        setUser(null);
        window.location.href = "/login";
      }
    };
    return () => channel.close();
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
