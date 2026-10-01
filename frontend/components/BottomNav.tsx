export function BottomNav({ view, onViewChange }: { view: "today" | "week"; onViewChange: (view: "today" | "week") => void }) {
  return (
    <nav aria-label="Перегляд розкладу" className="fixed inset-x-0 bottom-0 z-20 border-t border-sys-border bg-sys-bg/95 p-2 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md justify-around">
        {(["today", "week"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onViewChange(item)}
            aria-pressed={view === item}
            className={`flex min-w-[7rem] flex-col items-center gap-1 rounded-lg px-4 py-2 text-xs font-medium ${view === item ? "text-sys-accent" : "text-sys-text-secondary"}`}
          >
            <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              {item === "today" ? (
                <>
                  <rect x="3" y="4" width="18" height="17" rx="2" />
                  <path d="M16 2v4M8 2v4M3 9h18" />
                  <path d="M8 13h3v3H8z" />
                </>
              ) : (
                <>
                  <rect x="3" y="4" width="18" height="17" rx="2" />
                  <path d="M16 2v4M8 2v4M3 9h18M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01M16 17h.01" />
                </>
              )}
            </svg>
            {item === "today" ? "Сьогодні" : "Тиждень"}
          </button>
        ))}
      </div>
    </nav>
  );
}
