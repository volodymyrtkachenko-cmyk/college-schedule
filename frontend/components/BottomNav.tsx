export function BottomNav({ view, onViewChange }: { view: "today" | "week"; onViewChange: (view: "today" | "week") => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/95 p-2 backdrop-blur md:hidden">
      <div className="mx-auto flex max-w-md justify-around">
        {(["today", "week"] as const).map((item) => (
          <button key={item} onClick={() => onViewChange(item)} className={`flex min-w-[7rem] flex-col items-center gap-1 rounded-lg px-4 py-2 text-xs font-medium ${view === item ? "text-cyan-300" : "text-slate-500"}`}>
            <span className="text-lg">{item === "today" ? "•" : "▦"}</span>
            {item === "today" ? "Сьогодні" : "Тиждень"}
          </button>
        ))}
      </div>
    </nav>
  );
}
