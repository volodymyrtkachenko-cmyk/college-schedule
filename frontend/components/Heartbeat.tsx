"use client";
import { useEffect } from "react";

export function Heartbeat() {
    useEffect(() => {
        // Generate a random session ID for anonymous active-user metrics
        let sessionId = sessionStorage.getItem("pulse_sid");
        if (!sessionId) {
            sessionId = Math.random().toString(36).substring(2, 15);
            sessionStorage.setItem("pulse_sid", sessionId);
        }

        const baseUrl = process.env.NEXT_PUBLIC_API_URL || "";
        
        const ping = () => {
            fetch(`${baseUrl}/api/ping?sid=${sessionId}`).catch(() => {});
        };

        // Ping every 30 seconds if tab is active
        const interval = setInterval(() => {
            if (document.visibilityState === "visible") {
                ping();
            }
        }, 30_000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                // Send a beacon to immediately remove the user from online count
                navigator.sendBeacon(`${baseUrl}/api/ping?sid=${sessionId}&leave=1`);
            } else {
                ping();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);
        
        // Initial ping on mount
        ping();

        return () => {
            clearInterval(interval);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, []);

    return null;
}
