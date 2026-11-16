"use client";

import React from "react";

interface ThemeMorphButtonProps {
  resolvedTheme: "light" | "dark";
  onToggleTheme: (e?: React.MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  iconSize?: number;
}

export function ThemeMorphButton({
  resolvedTheme,
  onToggleTheme,
  className = "flex h-9 w-9 items-center justify-center rounded-xl text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary active:scale-95 transition-colors duration-fast ease-smooth focus:outline-none focus:ring-2 focus:ring-sys-accent cursor-pointer shrink-0",
  iconSize = 17,
}: ThemeMorphButtonProps) {
  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      onClick={(e) => onToggleTheme(e)}
      aria-label={
        isDark
          ? "Поточна тема: Темна (натисніть, щоб змінити)"
          : "Поточна тема: Світла (натисніть, щоб змінити)"
      }
      title={isDark ? "Поточна тема: Темна" : "Поточна тема: Світла"}
      className={className}
    >
      <span
        aria-hidden="true"
        className="relative flex items-center justify-center"
        style={{ width: iconSize, height: iconSize }}
      >
        {/* Moon (Dark mode active) */}
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`absolute inset-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${
            isDark
              ? "opacity-100 scale-100 rotate-0"
              : "opacity-0 scale-50 rotate-90 pointer-events-none"
          }`}
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>

        {/* Sun (Light mode active) */}
        <svg
          width={iconSize}
          height={iconSize}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`absolute inset-0 transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${
            isDark
              ? "opacity-0 scale-50 -rotate-90 pointer-events-none"
              : "opacity-100 scale-100 rotate-0"
          }`}
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2" />
          <path d="M12 20v2" />
          <path d="m4.93 4.93 1.41 1.41" />
          <path d="m17.66 17.66 1.41 1.41" />
          <path d="M2 12h2" />
          <path d="M20 12h2" />
          <path d="m6.34 17.66-1.41 1.41" />
          <path d="m19.07 4.93-1.41 1.41" />
        </svg>
      </span>
    </button>
  );
}
