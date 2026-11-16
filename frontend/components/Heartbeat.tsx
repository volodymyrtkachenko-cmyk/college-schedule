"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { BACKEND_API_URL } from "../lib/site";

export function Heartbeat() {
  const { user } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    let clientId = "";
    try {
      clientId = localStorage.getItem("pulse_client_id") || "";
      if (!clientId) {
        clientId = Math.random().toString(36).substring(2, 12);
        localStorage.setItem("pulse_client_id", clientId);
      }
    } catch {
      clientId = Math.random().toString(36).substring(2, 12);
    }

    let tabId = "";
    try {
      tabId = sessionStorage.getItem("pulse_tab_id") || "";
      if (!tabId) {
        tabId = Math.random().toString(36).substring(2, 9);
        sessionStorage.setItem("pulse_tab_id", tabId);
      }
    } catch {
      tabId = Math.random().toString(36).substring(2, 9);
    }

    const sessionId = `${clientId}_${tabId}`;
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || BACKEND_API_URL || "";

    const ping = async () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      if (typeof navigator !== "undefined" && (navigator as any).connection?.saveData) return;

      const currentUser = userRef.current;
      const role = currentUser?.role || "guest";
      const username = currentUser?.username || "";
      const name = currentUser?.name || "";

      const params = new URLSearchParams({
        sid: sessionId,
        role,
      });
      if (username) params.set("u", username);
      if (name) params.set("n", name);

      let authHeader = "";
      if (currentUser) {
        try {
          const session = await api.auth.ensureAuthenticated();
          if (session?.access_token) {
            authHeader = `Bearer ${session.access_token}`;
          }
        } catch {}
      }

      fetch(`${baseUrl}/api/ping?${params.toString()}`, {
        headers: authHeader ? { Authorization: authHeader } : {},
        keepalive: true,
        priority: "low",
      } as RequestInit & { priority?: "high" | "low" | "auto" }).catch(() => {});
    };

    // Запускаємо перший пінг у фоновому idle-вікні з низьким мережевим пріоритетом
    let initialTimer: ReturnType<typeof setTimeout> | null = null;
    let idleId: number | null = null;
    const sendInitialPing = () => {
      if (document.visibilityState === "visible") {
        void ping();
      }
    };
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = (window as any).requestIdleCallback(sendInitialPing, { timeout: 2000 });
    } else {
      initialTimer = setTimeout(sendInitialPing, 1500);
    }

    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void ping();
      }
    }, 45_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void ping();
      }
    };

    const handleLeave = () => {
      if (typeof navigator !== "undefined" && navigator.onLine && navigator.sendBeacon) {
        navigator.sendBeacon(`${baseUrl}/api/ping?sid=${sessionId}&leave=1`);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handleLeave);
    window.addEventListener("beforeunload", handleLeave);

    return () => {
      if (initialTimer) clearTimeout(initialTimer);
      if (idleId !== null && typeof window !== "undefined" && "cancelIdleCallback" in window) {
        (window as any).cancelIdleCallback(idleId);
      }
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handleLeave);
      window.removeEventListener("beforeunload", handleLeave);
    };
  }, []);

  return null;
}
