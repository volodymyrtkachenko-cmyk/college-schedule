"use client";

import { useMemo, useState } from "react";

type Option = { id: number; name: string };

export function SearchableMultiSelect({
  options,
  value,
  onChange,
  placeholder = "Знайти за назвою",
  ariaLabel = "Пошук серед груп",
}: {
  options: Option[];
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => options.filter((option) => option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [options, query],
  );

  function toggle(id: number) {
    onChange(value.includes(id) ? value.filter((selectedId) => selectedId !== id) : [...value, id]);
  }

  const count = value.length;
  const countLabel = count % 10 === 1 && count % 100 !== 11
    ? "групу"
    : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)
      ? "групи"
      : "груп";

  return (
    <div className="space-y-2">
      <div className="relative">
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted"
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          type="search"
          aria-label={ariaLabel}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          className="form-control w-full pl-9"
        />
      </div>
      <div className="max-h-60 overflow-y-auto rounded-xl border border-sys-border bg-sys-input/70 p-1.5">
        {filtered.map((option) => {
          const checked = value.includes(option.id);
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                checked ? "bg-sys-accent/10 text-sys-accent" : "text-sys-text-primary hover:bg-white/5"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(option.id)}
                className="h-4 w-4 accent-sys-accent"
              />
              <span>{option.name}</span>
            </label>
          );
        })}
        {filtered.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-sys-text-muted">За вашим запитом нічого не знайдено.</p>
        )}
      </div>
      <p className="text-xs text-sys-text-muted" aria-live="polite">
        Вибрано {count} {countLabel}
      </p>
    </div>
  );
}
