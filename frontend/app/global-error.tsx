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
            <div style={{ fontSize: "36px", marginBottom: "12px" }}>⚠️</div>
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
