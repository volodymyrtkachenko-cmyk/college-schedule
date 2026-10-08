"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api, AuthUser } from "./api";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth.ensureAuthenticated()
      .then((session) => setUser(session.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const session = await api.auth.login(username, password);
    setUser(session.user);
  }

  useEffect(() => {
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
    try {
      const success = await api.auth.logout();
      if (success) {
        const channel = new BroadcastChannel("auth_sync");
        channel.postMessage("logout");
        channel.close();
        setUser(null);
        window.location.href = "/login";
      }
    } catch (e) {
      console.error("Logout failed", e);
      // Don't clear local state if server logout failed!
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
