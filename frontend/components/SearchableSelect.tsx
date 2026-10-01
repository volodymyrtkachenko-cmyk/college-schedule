"use client";

import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

type Option = { id: number; name: string; disabled?: boolean };

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Оберіть зі списку",
  disabled,
  ariaLabel,
  emptyLabel = "Не вибрано",
}: {
  options: Option[];
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find((option) => option.id === value);
  const filtered = useMemo(
    () => options.filter((option) => option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    [options, query],
  );
  const enabled = filtered.filter((option) => !option.disabled);

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function select(id: number | null) {
    onChange(id);
    setOpen(false);
    setQuery("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setQuery("");
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, enabled.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && (activeIndex === 0 || enabled.length > 0)) {
      event.preventDefault();
      select(activeIndex === 0 ? null : enabled[activeIndex - 1]?.id ?? enabled[0].id);
    }
  }

  return (
    <div ref={ref} className="relative mt-1">
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? activeIndex === 0 ? `${listId}-option-none` : `${listId}-option-${enabled[activeIndex - 1]?.id}` : undefined}
        disabled={disabled}
        placeholder={open && selected ? selected.name : placeholder}
        value={open ? query : (selected ? selected.name : "")}
        onFocus={() => {
          setOpen(true);
          setQuery("");
          const selectedIndex = options.filter((option) => !option.disabled)
            .findIndex((option) => option.id === value);
          setActiveIndex(selectedIndex < 0 ? 0 : selectedIndex + 1);
        }}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={handleKeyDown}
        className="form-control w-full"
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-sys-border bg-sys-card py-1 shadow-2xl"
        >
          <div
            id={`${listId}-option-none`}
            role="option"
            aria-selected={value == null}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(0)}
            onClick={() => select(null)}
            className={`cursor-pointer px-4 py-2.5 text-sm text-sys-text-secondary transition-colors ${
              activeIndex === 0 ? "bg-sys-accent/10 text-sys-text-primary" : "hover:bg-sys-accent/10 hover:text-sys-text-primary"
            }`}
          >
            {emptyLabel}
          </div>
          {filtered.map((option) => {
            const optionIndex = enabled.findIndex((item) => item.id === option.id);
            const isActive = optionIndex + 1 === activeIndex && !option.disabled;
            return (
              <div
                key={option.id}
                id={`${listId}-option-${option.id}`}
                role="option"
                aria-selected={option.id === value}
                aria-disabled={option.disabled || undefined}
                tabIndex={-1}
                onMouseEnter={() => !option.disabled && setActiveIndex(optionIndex + 1)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => !option.disabled && select(option.id)}
                className={`px-4 py-2.5 text-sm transition-colors ${
                  option.id === value ? "bg-sys-accent/10 text-sys-accent" : "text-sys-text-primary"
                } ${option.disabled ? "cursor-default text-sys-text-muted" : "cursor-pointer"} ${
                  isActive ? "bg-sys-accent/10" : "hover:bg-sys-accent/10"
                }`}
              >
                {option.name}
              </div>
            );
          })}
          {enabled.length === 0 && (
            <p className="px-4 py-3 text-sm text-sys-text-muted" role="status">
              За вашим запитом нічого не знайдено.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
