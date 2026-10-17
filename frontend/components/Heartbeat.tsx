"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";

export function Heartbeat() {
    const { user } = useAuth();
    const userRef = useRef(user);
    userRef.current = user;

    useEffect(() => {
        // Persistent client identifier (shared across tabs on same device/browser)
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

        // Tab-specific identifier (so closing one tab sends leave beacon for that tab only)
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
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "";

        const ping = async () => {
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
                } catch {
                    // ignore
                }
            }

            fetch(`${baseUrl}/api/ping?${params.toString()}`, {
                headers: authHeader ? { Authorization: authHeader } : {},
            }).catch(() => {});
        };

        // Immediate ping on page load
        ping();

        // Heartbeat every 15 seconds while visible
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                ping();
            }
        }, 15_000);

        // Immediate ping when returning to tab
        const handleVisibilityChange = () => {
            if (document.visibilityState === "visible") {
                ping();
            }
        };

        // Notify server immediately when tab or browser is closed
        const handleLeave = () => {
            navigator.sendBeacon(`${baseUrl}/api/ping?sid=${sessionId}&leave=1`);
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        window.addEventListener("pagehide", handleLeave);
        window.addEventListener("beforeunload", handleLeave);

        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            window.removeEventListener("pagehide", handleLeave);
            window.removeEventListener("beforeunload", handleLeave);
        };
    }, []);

    // Immediately notify server when user logs in or out
    useEffect(() => {
        let clientId = "";
        let tabId = "";
        try {
            clientId = localStorage.getItem("pulse_client_id") || "";
            tabId = sessionStorage.getItem("pulse_tab_id") || "";
        } catch {}
        if (!clientId || !tabId) return;

        const sessionId = `${clientId}_${tabId}`;
        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "";
        const role = user?.role || "guest";
        const username = user?.username || "";
        const name = user?.name || "";

        const params = new URLSearchParams({
            sid: sessionId,
            role,
        });
        if (username) params.set("u", username);
        if (name) params.set("n", name);

        if (user) {
            api.auth.ensureAuthenticated()
                .then(session => {
                    fetch(`${baseUrl}/api/ping?${params.toString()}`, {
                        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
                    }).catch(() => {});
                })
                .catch(() => {
                    fetch(`${baseUrl}/api/ping?${params.toString()}`).catch(() => {});
                });
        } else {
            fetch(`${baseUrl}/api/ping?${params.toString()}`).catch(() => {});
        }
    }, [user]);

    return null;
}

