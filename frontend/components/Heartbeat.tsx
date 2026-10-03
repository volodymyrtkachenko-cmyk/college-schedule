"use client";
import { useEffect } from "react";

export function Heartbeat() {
    useEffect(() => {
        const ping = () => {
            fetch("/api/ping").catch(() => {});
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
                navigator.sendBeacon("/api/ping?leave=1");
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
