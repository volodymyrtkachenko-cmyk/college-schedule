"use client";

import React, { useEffect, useState } from "react";
import { BoltIcon } from "./ui/Icons";

interface GuideDemoStageProps {
  role: "student" | "teacher";
  stepIdx: number;
  isOpen: boolean;
}

function PlatformSvg({ platform }: { platform: "meet" | "zoom" }) {
  if (platform === "zoom") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
        <path d="M15 8c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v8c0 .55.45 1 1 1h11c.55 0 1-.45 1-1v-3.24l4.39 3.59c.35.29.88 0 .88-.45V7.1c0-.45-.53-.74-.88-.45L15 10.24V8z" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
      <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z" />
    </svg>
  );
}

function UserSvg() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-sys-text-muted shrink-0"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/**
 * Pure GPU-composited cursor overlay (`translate3d` over an `inset-0` track container).
 * Uses `transform` percentages relative to the track box — zero `left`/`top` layout thrash.
 */
function DemoCursor({
  x,
  y,
  clicking,
  hidden = false,
}: {
  x: string;
  y: string;
  clicking: boolean;
  hidden?: boolean;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-30 will-change-transform"
      style={{
        transform: `translate3d(${x}, ${y}, 0)`,
        transition: "transform 760ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
    >
      <div
        className="relative inline-block will-change-[transform,opacity]"
        style={{
          transform: `translate3d(-4px, -4px, 0) scale(${clicking ? 0.84 : 1})`,
          opacity: hidden ? 0 : 1,
          transition: "transform 200ms cubic-bezier(0.22, 1, 0.36, 1), opacity 260ms ease",
        }}
      >
        <span
          data-clicking={clicking && !hidden ? "true" : "false"}
          className="guide-cursor-ripple pointer-events-none opacity-0 absolute -left-2.5 -top-2.5 h-7 w-7 rounded-full border-2 border-sys-accent bg-sys-accent/35"
        />

        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
        >
          <path
            transform="translate(1.5 2)"
            d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.53.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
            fill="#0f172a"
            fillOpacity="0.22"
          />
          <path
            d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.45 0 .67-.53.35-.85L6.35 2.86a.5.5 0 0 0-.85.35Z"
            fill="#ffffff"
            stroke="#0f172a"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}

export const GuideDemoStage = React.memo(function GuideDemoStage({
  role,
  stepIdx,
  isOpen,
}: GuideDemoStageProps) {
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(0);
  const [cursorHidden, setCursorHidden] = useState(false);

  // Only 4 lightweight phase transitions per step change instead of continuous interval ticks.
  useEffect(() => {
    if (!isOpen) return;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      setStage(3);
      setCursorHidden(true);
      return;
    }

    setStage(0);
    setCursorHidden(false);

    const t1 = window.setTimeout(() => setStage(1), 780);
    const t2 = window.setTimeout(() => setStage(2), 1680);
    const t3 = window.setTimeout(() => setStage(3), 2150);
    const t4 = window.setTimeout(() => setCursorHidden(true), 3350);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.clearTimeout(t4);
    };
  }, [isOpen, role, stepIdx]);

  return (
    <div className="relative mx-auto w-full h-[236px] rounded-2xl border border-sys-border bg-sys-bg px-3.5 py-3 flex flex-col justify-center overflow-hidden [contain:layout_style_paint]">
      {/* =====================================================
          СТУДЕНТ 0: ХАБ ПРЕДМЕТА (Клік на назву -> SubjectHub)
         ===================================================== */}
      {role === "student" && stepIdx === 0 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px]">
          <DemoCursor
            x={stage === 0 ? "74%" : stage <= 2 ? "38%" : "82%"}
            y={stage === 0 ? "72%" : stage <= 2 ? "44%" : "22%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div
            className={`absolute inset-x-0 top-2 transition-[opacity,transform] duration-base ease-spring ${
              stage < 3 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
            }`}
            aria-hidden={stage >= 3}
          >
            <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between gap-2 h-8">
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                  <span className="text-sys-text-muted font-bold text-xs">·</span>
                  <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                </div>
                <span className="inline-flex h-7 px-2.5 items-center rounded-lg border border-sys-border bg-sys-bg text-xs font-medium text-sys-text-secondary">
                  ауд. 426
                </span>
              </div>

              <div>
                <span
                  className={`inline-block text-base font-semibold leading-snug rounded-md px-1 -mx-1 transition-colors duration-200 ${
                    stage >= 1
                      ? "text-sys-accent underline decoration-sys-accent/60 underline-offset-4 bg-sys-accent/10"
                      : "text-sys-text-subject"
                  } ${stage === 2 ? "scale-95" : ""}`}
                >
                  Вища математика
                </span>
                <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                  <UserSvg />
                  <span>Іваненко О.М.</span>
                </div>
              </div>
            </div>
          </div>

          <div
            className={`absolute inset-x-0 top-0.5 transition-[opacity,transform] duration-base ease-spring ${
              stage >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1.5 pointer-events-none"
            }`}
            aria-hidden={stage < 3}
          >
            <div className="rounded-2xl border border-sys-accent/35 bg-sys-card p-3.5 shadow-sm space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-sys-text-primary truncate">Вища математика</div>
                  <div className="text-[11px] font-semibold text-sys-accent mt-0.5">
                    Наступна: Чт, 09:00 · через 2 дні
                  </div>
                </div>
                <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-[10px] font-bold text-sys-text-secondary">
                  Знаменник
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 font-medium text-sys-text-secondary">
                  Пн · 1 пара
                </span>
                <span className="rounded-lg border border-sys-accent/30 bg-sys-accent/10 px-2 py-0.5 font-semibold text-sys-accent">
                  Чт · 1 пара
                </span>
                <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 font-medium text-sys-text-muted">
                  24 / 32 год
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-sys-border bg-sys-bg/70 px-2.5 py-1.5">
                  <div className="text-[10px] font-semibold text-sys-text-muted">Завдання</div>
                  <div className="text-xs font-bold text-sys-text-primary">2 активні · до пт</div>
                </div>
                <div className="rounded-xl border border-sys-border bg-sys-bg/70 px-2.5 py-1.5">
                  <div className="text-[10px] font-semibold text-sys-text-muted">Середній бал</div>
                  <div className="text-xs font-bold text-sys-status-okText">11.0 / 12 б.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          СТУДЕНТ 1: ПІДГРУПИ (Стабільні координати без стрибків)
         ===================================================== */}
      {role === "student" && stepIdx === 1 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px] flex flex-col justify-start pt-1">
          <DemoCursor
            x={stage === 0 ? "60%" : stage <= 2 ? "18%" : "82%"}
            y={stage === 0 ? "78%" : stage <= 2 ? "54%" : "18%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-2 h-8">
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                <span className="text-sys-text-muted font-bold text-xs">·</span>
                <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
              </div>
              <span
                className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-bold transition-[opacity,transform] duration-base ease-spring ${
                  stage >= 3 ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
                }`}
              >
                <PlatformSvg platform="meet" />
                <span>Meet</span>
                <span className="opacity-75">↗</span>
              </span>
            </div>

            <div className="text-sm sm:text-base font-semibold text-sys-text-subject leading-snug truncate">
              Іноземна мова (за проф. спрямуванням)
            </div>

            {/* Subgroup 1 Row */}
            <div className="flex items-center justify-between gap-2 h-7">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-semibold transition-colors duration-200 ${
                    stage >= 3
                      ? "border-sys-accent/35 bg-sys-accent/15 text-sys-accent"
                      : stage >= 1
                        ? "border-sys-accent/50 bg-sys-accent/10 text-sys-text-primary"
                        : "bg-sys-bg/80 border-sys-border text-sys-text-secondary"
                  } ${stage === 2 ? "scale-95" : ""}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${stage >= 3 ? "bg-sys-accent" : "bg-sys-text-muted/60"}`} />
                  <span>1 підгр.</span>
                </span>
                <UserSvg />
                <span className="text-xs font-medium text-sys-text-secondary truncate">
                  Петренко І.В.
                </span>
              </div>

              <span
                className={`inline-flex h-7 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-okBg/50 bg-sys-status-okBg/15 text-sys-status-okText text-xs font-semibold transition-opacity duration-base ease-spring ${
                  stage < 3 ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <PlatformSvg platform="meet" />
                <span>Meet ↗</span>
              </span>
            </div>

            {/* Subgroup 2 Row — GPU-only fade & slight shift without layout reflow */}
            <div
              aria-hidden={stage >= 3}
              className={`transition-[transform,opacity] duration-base ease-spring ${
                stage < 3 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
              }`}
            >
              <div className="flex items-center justify-between gap-2 h-7">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex shrink-0 items-center gap-1.5 h-6 px-2 rounded-md border border-sys-border bg-sys-bg/80 text-xs font-semibold text-sys-text-secondary">
                    <span className="h-1.5 w-1.5 rounded-full bg-sys-text-muted/60" />
                    <span>2 підгр.</span>
                  </span>
                  <UserSvg />
                  <span className="text-xs font-medium text-sys-text-secondary truncate">
                    Коваленко Н.С.
                  </span>
                </div>
                <span className="shrink-0 rounded-md border border-sys-border bg-sys-bg px-2 py-1 text-xs font-semibold leading-none text-sys-text-secondary">
                  ауд. 204
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          СТУДЕНТ 2: ZOOM ТА АВТОКОПІЮВАННЯ ПАРОЛЯ
         ===================================================== */}
      {role === "student" && stepIdx === 2 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px] flex flex-col justify-start pt-2 space-y-2.5">
          <DemoCursor
            x={stage === 0 ? "35%" : stage <= 2 ? "84%" : "86%"}
            y={stage === 0 ? "62%" : stage <= 2 ? "20%" : "68%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-2 h-8">
              <div className="flex items-center gap-2">
                <span className="text-base font-black text-sys-text-primary leading-none">3</span>
                <span className="text-sys-text-muted font-bold text-xs">·</span>
                <span className="text-xs font-semibold text-sys-text-secondary">12:30–13:50</span>
              </div>

              <span
                className={`inline-flex h-8 px-2.5 items-center gap-1.5 rounded-lg border border-sys-status-infoBg/50 bg-sys-status-infoBg/15 text-sys-status-infoText text-xs font-bold shadow-xs transition-transform duration-base ease-spring ${
                  stage === 2 ? "scale-95" : ""
                }`}
              >
                <PlatformSvg platform="zoom" />
                <span>Zoom</span>
                <span className="opacity-75">↗</span>
              </span>
            </div>

            <div>
              <div className="text-base font-semibold text-sys-text-subject leading-snug truncate">
                Електроніка та мікросхемотехніка
              </div>
              <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary mt-1">
                <UserSvg />
                <span>Мельник В.П.</span>
              </div>
            </div>
          </div>

          <div
            className={`flex items-center gap-2 rounded-[8px] border border-sys-status-okBg/40 bg-sys-card px-3.5 py-2.5 text-xs font-semibold text-sys-status-okText shadow-sm transition-[opacity,transform] duration-base ease-spring ${
              stage >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1.5 pointer-events-none"
            }`}
            aria-hidden={stage < 3}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M5 12l5 5l10 -10" />
            </svg>
            <span>Код доступу Zoom (dfkr) скопійовано!</span>
          </div>
        </div>
      )}

      {/* =====================================================
          СТУДЕНТ 3: ПЕРЕХІД ДО ВИКЛАДАЧА
         ===================================================== */}
      {role === "student" && stepIdx === 3 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px]">
          <DemoCursor
            x={stage === 0 ? "68%" : stage <= 2 ? "26%" : "82%"}
            y={stage === 0 ? "22%" : stage <= 2 ? "58%" : "16%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div
            className={`absolute inset-x-0 top-2 transition-[opacity,transform] duration-base ease-spring ${
              stage < 3 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
            }`}
            aria-hidden={stage >= 3}
          >
            <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between h-8">
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-sys-text-primary leading-none">2</span>
                  <span className="text-sys-text-muted font-bold text-xs">·</span>
                  <span className="text-xs font-semibold text-sys-text-secondary">10:40–12:00</span>
                </div>
                <span className="inline-flex h-8 px-2.5 items-center rounded-lg border border-sys-border bg-sys-bg text-xs font-medium text-sys-text-secondary">
                  ауд. 305
                </span>
              </div>

              <div className="text-base font-semibold text-sys-text-subject">
                Комп&apos;ютерна схемотехніка
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <UserSvg />
                <span
                  className={`font-medium transition-colors duration-200 ${
                    stage >= 1 ? "text-sys-accent underline underline-offset-2" : "text-sys-text-secondary"
                  } ${stage === 2 ? "scale-95" : ""}`}
                >
                  Іваненко О.М.
                </span>
              </div>
            </div>
          </div>

          <div
            className={`absolute inset-x-0 top-1 space-y-2.5 transition-[opacity,transform] duration-base ease-spring ${
              stage >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
            }`}
            aria-hidden={stage < 3}
          >
            <div className="flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
              <span className="text-sys-text-secondary truncate mr-2">
                Розклад: <strong className="text-sys-text-primary">Іваненко О.М.</strong>
              </span>
              <span className="shrink-0 rounded-lg bg-sys-accentSolid px-2.5 py-1 text-xs font-semibold text-sys-onAccent">
                ← Повернутися
              </span>
            </div>

            <div className="rounded-2xl border border-sys-border bg-sys-card p-3.5 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-sys-text-secondary">2 · 10:40–12:00</span>
                <span className="rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-medium text-sys-text-secondary">
                  ауд. 305
                </span>
              </div>
              <div className="text-sm font-semibold text-sys-text-subject">Комп&apos;ютерна схемотехніка</div>
              <div className="flex items-center gap-1.5 text-xs text-sys-text-secondary">
                <UserSvg />
                <span className="text-sys-text-muted">Група:</span>
                <span className="font-medium text-sys-text-secondary">85</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          СТУДЕНТ 4: НАВІГАЦІЯ З КЛАВІАТУРИ ТА СВАЙПИ
         ===================================================== */}
      {role === "student" && stepIdx === 4 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px] flex flex-col justify-between py-1">
          <DemoCursor
            x={stage === 0 ? "70%" : stage <= 2 ? "30%" : "82%"}
            y={stage <= 2 ? "44%" : "84%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div className="relative grid grid-cols-5 rounded-xl border border-sys-border bg-sys-card p-1 text-[11px] font-semibold isolate">
            <div
              className="absolute top-1 bottom-1 transition-transform duration-base ease-spring transform-gpu z-0"
              style={{
                left: "4px",
                width: "calc((100% - 8px) / 5)",
                transform: `translate3d(${stage >= 3 ? "100%" : "0%"}, 0, 0)`,
              }}
            >
              <div className="h-full w-full rounded-lg bg-sys-accentSolid shadow-2xs" />
            </div>
            {["Пн 16", "Вт 17", "Ср 18", "Чт 19", "Пт 20"].map((label, idx) => {
              const isCurrent = (stage >= 3 ? 1 : 0) === idx;
              return (
                <div
                  key={label}
                  className={`relative z-10 py-1.5 text-center transition-colors duration-200 ${
                    isCurrent ? "text-sys-onAccent font-bold" : "text-sys-text-secondary"
                  }`}
                >
                  {label}
                </div>
              );
            })}
          </div>

          <div className="relative h-[86px] rounded-2xl border border-sys-border bg-sys-card overflow-hidden shadow-xs">
            <div
              className={`absolute inset-0 p-3 flex flex-col justify-between transition-[opacity,transform] duration-base ease-spring ${
                stage < 3 ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4 pointer-events-none"
              }`}
              aria-hidden={stage >= 3}
            >
              <div className="flex items-center justify-between text-[11px] text-sys-text-secondary">
                <span className="font-bold text-sys-text-primary">Понеділок · 1 пара</span>
                <span>09:00–10:20</span>
              </div>
              <div className="text-sm font-semibold text-sys-text-subject truncate">Вища математика</div>
              <div className="flex items-center justify-between text-[11px] text-sys-text-muted">
                <span>ауд. 426</span>
                <span className="text-sys-accent font-medium">← Свайп або →</span>
              </div>
            </div>

            <div
              className={`absolute inset-0 p-3 flex flex-col justify-between transition-[opacity,transform] duration-base ease-spring ${
                stage >= 3 ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4 pointer-events-none"
              }`}
              aria-hidden={stage < 3}
            >
              <div className="flex items-center justify-between text-[11px] text-sys-text-secondary">
                <span className="font-bold text-sys-text-primary">Вівторок · 1 пара</span>
                <span>09:00–10:20</span>
              </div>
              <div className="text-sm font-semibold text-sys-text-subject truncate">Алгоритми та структури даних</div>
              <div className="flex items-center justify-between text-[11px] text-sys-text-muted">
                <span>ауд. 312</span>
                <span className="text-sys-status-okText font-semibold">Переключено</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-semibold text-sys-text-secondary">
            {[
              { k: "← / →", v: "дні" },
              { k: "D / W", v: "вигляд" },
              { k: "T", v: "сьогодні" },
              { k: "Ctrl+K", v: "пошук" },
            ].map((item) => (
              <span
                key={item.k}
                className="inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-card px-2 py-1"
              >
                <kbd className="font-mono font-bold text-sys-text-primary">{item.k}</kbd>
                <span className="text-sys-text-muted">{item.v}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================
          ВИКЛАДАЧ 0: ПЕРЕХІД ДО РОЗКЛАДУ ГРУПИ
         ===================================================== */}
      {role === "teacher" && stepIdx === 0 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px]">
          <DemoCursor
            x={stage === 0 ? "68%" : stage <= 2 ? "22%" : "82%"}
            y={stage === 0 ? "24%" : stage <= 2 ? "59%" : "16%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div
            className={`absolute inset-x-0 top-2 transition-[opacity,transform] duration-base ease-spring ${
              stage < 3 ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1 pointer-events-none"
            }`}
            aria-hidden={stage >= 3}
          >
            <div className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-sm space-y-2.5">
              <div className="flex items-center justify-between h-8">
                <div className="flex items-center gap-2">
                  <span className="text-base font-black text-sys-text-primary leading-none">1</span>
                  <span className="text-sys-text-muted font-bold text-xs">·</span>
                  <span className="text-xs font-semibold text-sys-text-secondary">09:00–10:20</span>
                </div>
                <span className="inline-flex h-8 px-2.5 items-center rounded-lg border border-sys-border bg-sys-bg text-xs font-medium text-sys-text-secondary">
                  ауд. 305
                </span>
              </div>

              <div className="text-base font-semibold text-sys-text-subject">
                Комп&apos;ютерна схемотехніка
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <UserSvg />
                <span className="text-sys-text-muted">Група:</span>
                <span
                  className={`font-semibold rounded px-1.5 py-0.5 transition-colors duration-200 ${
                    stage >= 1
                      ? "text-sys-accent bg-sys-accent/10 underline underline-offset-2"
                      : "text-sys-text-primary"
                  } ${stage === 2 ? "scale-95" : ""}`}
                >
                  85
                </span>
              </div>
            </div>
          </div>

          <div
            className={`absolute inset-x-0 top-1 space-y-2 transition-[opacity,transform] duration-base ease-spring ${
              stage >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1 pointer-events-none"
            }`}
            aria-hidden={stage < 3}
          >
            <div className="flex items-center justify-between rounded-xl border border-sys-accent/30 bg-sys-accent/10 px-3 py-2 text-xs">
              <span className="text-sys-text-secondary truncate mr-2">
                Розклад: <strong className="text-sys-text-primary">Група 85</strong>
              </span>
              <span className="shrink-0 rounded-lg bg-sys-accentSolid px-2.5 py-1 text-xs font-semibold text-sys-onAccent">
                ← Повернутися
              </span>
            </div>

            <div className="rounded-2xl border border-sys-border bg-sys-card p-3 shadow-xs space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sys-text-primary">1 · Вища математика</span>
                <span className="text-[11px] text-sys-text-muted">ауд. 426</span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-dashed border-sys-status-okBg/40 bg-sys-status-okBg/10 px-2.5 py-1.5">
                <span className="font-semibold text-sys-status-okText">2 · 10:40–12:00</span>
                <span className="text-[11px] font-bold text-sys-status-okText">Вільно («вікно»)</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ВИКЛАДАЧ 1: СТАТИСТИКА
         ===================================================== */}
      {role === "teacher" && stepIdx === 1 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px] flex flex-col justify-center space-y-2.5">
          <DemoCursor
            x={stage === 0 ? "30%" : stage <= 2 ? "65%" : "82%"}
            y={stage === 0 ? "24%" : stage <= 2 ? "68%" : "68%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div className="grid grid-cols-2 gap-2.5">
            <div className="rounded-2xl border border-sys-border bg-sys-card p-2.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sys-text-secondary">
                Проведено
              </p>
              <p className="text-xl font-black text-sys-accent leading-tight mt-0.5">96</p>
              <p className="text-[10px] text-sys-text-muted">акад. год · 48 пар</p>
            </div>
            <div className="rounded-2xl border border-sys-border bg-sys-card p-2.5 text-center">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-sys-text-secondary">
                Навантаження
              </p>
              <p className="text-xl font-black text-sys-text-primary leading-tight mt-0.5">16</p>
              <p className="text-[10px] text-sys-text-muted">акад. год/тиждень · 8 пар</p>
            </div>
          </div>

          <div className="rounded-2xl border border-sys-border bg-sys-card p-3 flex items-center gap-3.5">
            <div className="relative w-12 h-12 shrink-0 flex items-center justify-center">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 48 48">
                <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="4" fill="none" className="text-sys-border" />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                  strokeDasharray={125.6}
                  strokeDashoffset={32}
                  className="text-sys-accent"
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-[11px] font-bold text-sys-text-primary">68г</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-sys-text-primary truncate">
                Комп&apos;ютерна схемотехніка
              </div>
              <div className="text-[11px] text-sys-text-secondary mt-0.5">
                68 акад. год · 34 пар
              </div>
              <div className="flex items-center gap-1 mt-1">
                <span className="text-[10px] text-sys-text-muted">Групи:</span>
                <span className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary">
                  85
                </span>
                <span className="rounded bg-sys-elevated border border-sys-border px-1.5 py-0.5 text-[10px] font-medium text-sys-text-secondary">
                  86
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ВИКЛАДАЧ 2: ЗАМІНИ ТА ПЕРЕНЕСЕННЯ
         ===================================================== */}
      {role === "teacher" && stepIdx === 2 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px] flex flex-col justify-start pt-2 space-y-2.5">
          <DemoCursor
            x={stage === 0 ? "50%" : stage <= 2 ? "70%" : "82%"}
            y={stage === 0 ? "16%" : stage <= 2 ? "16%" : "68%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div className="relative flex h-10 w-full rounded-xl border border-sys-border bg-sys-card overflow-hidden text-xs">
            <div
              className="absolute bottom-0 left-0 h-[3px] bg-sys-accent transition-transform duration-base ease-spring"
              style={{
                width: "20%",
                transform: `translate3d(${(stage >= 3 ? 3 : 2) * 100}%, 0, 0)`,
              }}
            />
            {["Пн 10", "Вт 11", "Ср 12", "Чт 13", "Пт 14"].map((d, i) => {
              const active = (stage >= 3 ? 3 : 2) === i;
              return (
                <div
                  key={d}
                  className={`flex-1 flex items-center justify-center font-semibold transition-colors duration-200 ${
                    active ? "text-sys-text-primary font-bold" : "text-sys-text-secondary"
                  }`}
                >
                  {d}
                </div>
              );
            })}
          </div>

          <div className="grid min-h-[112px]">
            <div
              aria-hidden={stage >= 3}
              className={`col-start-1 row-start-1 rounded-2xl border border-sys-status-dangerBg/40 border-dashed bg-sys-card p-3.5 space-y-1.5 min-h-[108px] transition-opacity duration-200 ease-smooth ${
                stage < 3 ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sys-text-secondary shrink-0">3 · 12:30–13:50</span>
                <span className="rounded px-1.5 py-0.5 text-[11px] sm:text-xs font-bold border border-sys-status-warnBg/40 bg-sys-status-warnBg/15 text-sys-status-warnText truncate">
                  ↪ Перенесено → Чт, 3 пара
                </span>
              </div>
              <div className="text-base font-semibold line-through text-sys-text-muted">
                Мікропроцесорні системи
              </div>
              <div className="text-xs text-sys-text-secondary">Група: 85</div>
            </div>
            <div
              aria-hidden={stage < 3}
              className={`col-start-1 row-start-1 rounded-2xl border border-sys-warning/40 ring-1 ring-sys-warning/60 bg-sys-card p-3.5 space-y-1.5 min-h-[108px] transition-opacity duration-200 ease-smooth ${
                stage >= 3 ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-sys-text-secondary">3 · 12:30–13:50</span>
                <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-bold bg-sys-warning uppercase tracking-wider text-sys-warningText">
                  <BoltIcon className="h-3 w-3 shrink-0" />
                  <span>Заміна</span>
                </span>
              </div>
              <div className="text-base font-semibold text-sys-text-subject">
                Мікропроцесорні системи
              </div>
              <div className="text-xs text-sys-text-secondary">Група: 85 • ауд. 305</div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================
          ВИКЛАДАЧ 3: ЕКСПОРТ PNG ТА НАВІГАЦІЯ З КЛАВІАТУРИ / СВАЙПИ
         ===================================================== */}
      {role === "teacher" && stepIdx === 3 && (
        <div className="relative w-full max-w-[400px] mx-auto h-[196px] flex flex-col justify-between py-1">
          <DemoCursor
            x={stage === 0 ? "22%" : stage <= 2 ? "56%" : "82%"}
            y={stage === 0 ? "48%" : stage <= 2 ? "16%" : "68%"}
            clicking={stage === 2}
            hidden={cursorHidden}
          />

          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-sys-text-primary truncate">Понеділок · Тиждень</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-[border-color,background-color,transform] duration-200 ${
                  stage >= 1
                    ? "border-sky-500/50 bg-sky-500/10 text-sky-600 dark:text-sky-300"
                    : "border-sys-border bg-sys-card text-sys-text-secondary"
                } ${stage === 2 ? "scale-95" : ""}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <span>Зберегти картинку</span>
              </span>
            </div>
          </div>

          <div className="grid min-h-[104px]">
            <div
              aria-hidden={stage >= 3}
              className={`col-start-1 row-start-1 rounded-2xl border border-sys-border bg-sys-card p-3 space-y-2 transition-[opacity,transform] duration-base ease-spring ${
                stage < 3 ? "opacity-100 scale-100" : "opacity-0 scale-[0.98] pointer-events-none"
              }`}
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-sys-text-subject">1 · Дискретна математика</span>
                <span className="text-[11px] text-sys-text-muted">гр. 85</span>
              </div>
              <div className="flex items-center justify-between text-xs border-t border-sys-border/60 pt-2">
                <span className="font-semibold text-sys-text-subject">2 · Комп&apos;ютерна схемотехніка</span>
                <span className="text-[11px] text-sys-text-muted">гр. 99</span>
              </div>
            </div>

            <div
              aria-hidden={stage < 3}
              className={`col-start-1 row-start-1 rounded-2xl border border-sys-status-okBg/40 bg-sys-card p-3 flex items-center justify-between gap-3 transition-[opacity,transform] duration-base ease-spring ${
                stage >= 3 ? "opacity-100 scale-100" : "opacity-0 scale-[0.98] pointer-events-none"
              }`}
            >
              <div className="space-y-1 min-w-0">
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-sys-status-okText">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12l5 5l10 -10" />
                  </svg>
                  <span>PNG готовий до відправки</span>
                </div>
                <div className="text-xs font-semibold text-sys-text-primary truncate">
                  Чітка картка дня або всього тижня
                </div>
                <div className="text-[11px] text-sys-text-muted">
                  Зберігає чи передає у буфер обміну
                </div>
              </div>
              <span className="shrink-0 rounded-xl border border-sys-border bg-sys-bg px-2.5 py-1.5 text-[11px] font-mono font-bold text-sys-text-secondary">
                .png
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px] font-semibold text-sys-text-secondary">
            {[
              { k: "← / →", v: "дні" },
              { k: "D / W", v: "вигляд" },
              { k: "T", v: "сьогодні" },
              { k: "Ctrl+K", v: "пошук" },
            ].map((item) => (
              <span
                key={item.k}
                className="inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-card px-2 py-1"
              >
                <kbd className="font-mono font-bold text-sys-text-primary">{item.k}</kbd>
                <span className="text-sys-text-muted">{item.v}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
