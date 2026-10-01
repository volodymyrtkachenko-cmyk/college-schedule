"use client";
import { KeyboardEvent, useState, useRef, useEffect, useId } from "react";

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
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  const filtered = options.filter(o => o.toLowerCase().includes(value.toLowerCase()) && o !== value);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && filtered.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp" && filtered.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && filtered[activeIndex]) {
      event.preventDefault();
      onChange(filtered[activeIndex]);
      setOpen(false);
    }
  }

  return (
    <div ref={ref} className="relative mt-1">
      <input
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onFocus={() => { setOpen(true); setActiveIndex(0); }}
        onChange={(e) => {
          setOpen(true);
          setActiveIndex(0);
          onChange(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        className="form-control w-full"
      />
      {open && filtered.length > 0 && (
        <div id={listId} role="listbox" className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-sys-border bg-sys-card py-1 shadow-2xl">
          {filtered.map((o, index) => (
            <button 
              key={o} 
              id={`${listId}-option-${index}`}
              type="button" 
              role="option"
              aria-selected={index === activeIndex}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => event.preventDefault()}
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
