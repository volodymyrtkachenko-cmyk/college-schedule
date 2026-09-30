"use client";
import { useState, useRef, useEffect } from "react";

export function SearchableTextInput({
  options, value, onChange, placeholder = "", disabled
}: {
  options: string[];
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value);

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
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setOpen(true);
          onChange(e.target.value);
        }}
        className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2.5 text-sys-text-primary outline-none focus:border-sys-accent transition-colors"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-sys-border bg-sys-card shadow-2xl py-1">
          {filtered.map((o) => (
            <button 
              key={o} 
              type="button" 
              onClick={() => { onChange(o); setOpen(false); }} 
              className="block w-full px-4 py-2 text-left text-sm hover:bg-sys-border/50 transition-colors text-sys-text-primary"
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
