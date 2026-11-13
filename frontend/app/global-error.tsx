"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Глобальна помилка застосунку розкладу:", error);
  }, [error]);

  return (
    <html lang="uk">
      <head>
        <title>Розклад ДФКР — Помилка завантаження</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </head>
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, sans-serif", backgroundColor: "#121417", color: "#f3f4f6" }}>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
          }}
        >
          <div
            style={{
              maxWidth: "460px",
              width: "100%",
              padding: "24px",
              borderRadius: "16px",
              backgroundColor: "#1c1f26",
              border: "1px solid #2e333d",
              textAlign: "center",
            }}
          >
            <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "48px", height: "48px", borderRadius: "9999px", backgroundColor: "rgba(245, 158, 11, 0.14)", color: "#fbbf24", marginBottom: "14px" }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4M12 17h.01" />
              </svg>
            </div>
            <h1 style={{ fontSize: "18px", fontWeight: "bold", margin: "0 0 8px 0" }}>
              Розклад ДФКР тимчасово недоступний
            </h1>
            <p style={{ fontSize: "14px", color: "#9ca3af", lineHeight: "1.5", margin: "0 0 20px 0" }}>
              Сталася неочікувана помилка при завантаженні інтерфейсу. Спробуйте оновити сторінку або повторіть спробу пізніше.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
              <button
                type="button"
                onClick={() => reset()}
                style={{
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: "none",
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Оновити сторінку
              </button>
              <a
                href="/"
                style={{
                  display: "inline-block",
                  padding: "10px 18px",
                  borderRadius: "10px",
                  border: "1px solid #374151",
                  backgroundColor: "#262b35",
                  color: "#f3f4f6",
                  fontSize: "14px",
                  fontWeight: "500",
                  textDecoration: "none",
                }}
              >
                На головну
              </a>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
