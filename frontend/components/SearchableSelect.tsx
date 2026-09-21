"use client";
import { useState, useRef, useEffect } from "react";

type Option = { id: number; name: string };

export function SearchableSelect({
  options, value, onChange, placeholder = "Оберіть...", disabled,
}: {
  options: Option[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.id === value);
  const filtered = options.filter((o) => o.name.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  return (
    <div ref={ref} className="relative mt-1">
      <input
        type="text"
        disabled={disabled}
        placeholder={selected ? selected.name : placeholder}
        value={open ? query : ""}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2.5 text-sys-text-primary outline-none focus:border-sys-accent transition-colors"
      />
      {open && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-sys-border bg-sys-card shadow-2xl py-1">
          <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="block w-full px-4 py-2 text-left text-sm text-sys-text-secondary hover:bg-sys-border/50 transition-colors">
            — Немає —
          </button>
          {filtered.map((o) => (
            <button key={o.id} type="button" onClick={() => { onChange(o.id); setOpen(false); }} className="block w-full px-4 py-2 text-left text-sm hover:bg-sys-border/50 transition-colors text-sys-text-primary">
              {o.name}
            </button>
          ))}
          {filtered.length === 0 && <p className="px-4 py-2 text-sm text-sys-text-muted">Нічого не знайдено</p>}
        </div>
      )}
    </div>
  );
}
