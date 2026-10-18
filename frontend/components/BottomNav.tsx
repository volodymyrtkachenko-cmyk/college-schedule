"use client";

function vibrateTap(ms = 10) {
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    try {
      navigator.vibrate(ms);
    } catch {}
  }
}

export function BottomNav({
  view,
  onViewChange,
}: {
  view: "today" | "week";
  onViewChange: (view: "today" | "week") => void;
}) {
  return (
    <nav
      aria-label="Режим перегляду"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-sys-border/80 bg-sys-bg/95 p-2 pb-[max(0.6rem,env(safe-area-inset-bottom))] backdrop-blur-md sm:hidden"
    >
      <div className="relative mx-auto flex max-w-xs rounded-xl border border-sys-border bg-sys-card p-1 shadow-md">
        {/* Sliding indicator via transform: translateX */}
        <div
          aria-hidden="true"
          className="absolute bottom-1 left-1 top-1 w-[calc(50%-4px)] rounded-lg border border-sys-accent/30 bg-sys-accent/15 shadow-xs transition-transform duration-200 ease-smooth motion-reduce:transition-none"
          style={{
            transform: view === "today" ? "translateX(0%)" : "translateX(100%)",
          }}
        />

        <button
          type="button"
          onClick={() => {
            vibrateTap(10);
            onViewChange("today");
          }}
          aria-pressed={view === "today"}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none ${
            view === "today"
              ? "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M16 2v4M8 2v4M3 9h18" />
            <path d="M8 13h3v3H8z" />
          </svg>
          <span>Сьогодні</span>
        </button>

        <button
          type="button"
          onClick={() => {
            vibrateTap(10);
            onViewChange("week");
          }}
          aria-pressed={view === "week"}
          className={`relative z-10 flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold transition-transform duration-100 active:scale-[0.98] motion-reduce:transition-none ${
            view === "week"
              ? "font-bold text-sys-accent"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="4" width="18" height="17" rx="2" />
            <path d="M16 2v4M8 2v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" />
          </svg>
          <span>Тиждень</span>
        </button>
      </div>
    </nav>
  );
}
