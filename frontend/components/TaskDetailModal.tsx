"use client";

import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/lib/dialogTopLayer";
import { EASE_EXIT, EASE_SMOOTH } from "@/lib/motion";
import {
  formatMaterialCount,
  formatMaterialKindLabel,
  type ResolvedTaskDetail,
  type TaskMaterialItem,
  type TaskMaterialKind,
} from "@/lib/schedule";
import { markPendingClassroomReturn, setTaskManualDone } from "@/lib/useClassroomSubmissions";
import { useOptionalToast } from "./ToastProvider";
import { AppDialog } from "./ui/AppDialog";
import { CheckIcon, ChevronDownIcon, ClockIcon, CloseIcon, FileTextIcon, UserCheckIcon } from "./ui/Icons";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

const PANEL_EASING = `cubic-bezier(${EASE_SMOOTH.join(", ")})`;
const EXIT_EASING = `cubic-bezier(${EASE_EXIT.join(", ")})`;

const KIND_BADGE_STYLES: Record<TaskMaterialKind, string> = {
  pdf: "bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-300",
  doc: "bg-sky-500/10 border-sky-500/25 text-sky-700 dark:text-sky-300",
  sheet: "bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300",
  slide: "bg-amber-500/10 border-amber-500/25 text-amber-800 dark:text-amber-300",
  form: "bg-violet-500/10 border-violet-500/25 text-violet-700 dark:text-violet-300",
  video: "bg-red-500/10 border-red-500/25 text-red-700 dark:text-red-300",
  link: "bg-indigo-500/10 border-indigo-500/25 text-indigo-700 dark:text-indigo-300",
  file: "bg-sys-elevated border-sys-border/80 text-sys-text-secondary",
};

function getAttachmentPreviewLines(material: TaskMaterialItem, detail: ResolvedTaskDetail): string[] {
  const kindLabel = formatMaterialKindLabel(material.kind);
  switch (material.kind) {
    case "pdf":
      return [
        `${kindLabel}-матеріал до теми «${detail.subject}».`,
        "Містить покрокові вказівки до виконання, вимоги до оформлення розділів та контрольні запитання для самоперевірки.",
      ];
    case "sheet":
      return [
        `Таблиця вихідних даних та коефіцієнтів за варіантами (${detail.subject}).`,
        "Оберіть рядок за номером у списку групи, перевірте одиниці вимірювання та перенесіть розрахунки у звіт.",
      ];
    case "doc":
      return [
        "Текстовий шаблон зі структурою титульної сторінки, полями для вихідних даних, результатами моделювання та висновками.",
      ];
    case "slide":
      return [
        `Оглядова презентація до заняття «${detail.subject}» із ключовими схемами та формулами.`,
      ];
    case "form":
      return [
        "Онлайн-форма контролю знань Google Forms. Відповіді надсилаються безпосередньо до облікового запису викладача.",
      ];
    default:
      return [
        `Додатковий матеріал (${kindLabel}) для завдання «${detail.title}».`,
        material.url
          ? "Для перегляду оригіналу або завантаження скористайтесь кнопкою «Відкрити оригінал ↗»."
          : "Прикріплений файл без прямого зовнішнього посилання.",
      ];
  }
}

export interface TaskDetailModalProps {
  isOpen: boolean;
  detail: ResolvedTaskDetail | null;
  isLinked: boolean;
  onClose: () => void;
}

export function TaskDetailModal({
  isOpen,
  detail,
  isLinked,
  onClose,
}: TaskDetailModalProps) {
  const titleId = useId();
  const descRegionId = useId();
  const filesRegionId = useId();
  const optionalToast = useOptionalToast();

  const [descExpanded, setDescExpanded] = useState(false);
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [previewFileIdx, setPreviewFileIdx] = useState<number | null>(null);
  const [renderedPreviewIdx, setRenderedPreviewIdx] = useState<number | null>(null);

  const scrollBodyRef = useRef<HTMLDivElement | null>(null);

  // Description measured height refs
  const descClipRef = useRef<HTMLDivElement | null>(null);
  const descContentRef = useRef<HTMLDivElement | null>(null);
  const leadBlockRef = useRef<HTMLParagraphElement | null>(null);
  const descAnimRef = useRef<Animation | null>(null);
  const pendingDescFromHRef = useRef<number | null>(null);
  const descExpandedRef = useRef(descExpanded);
  descExpandedRef.current = descExpanded;

  // Files measured height refs
  const filesClipRef = useRef<HTMLDivElement | null>(null);
  const filesInnerRef = useRef<HTMLDivElement | null>(null);
  const filesAnimRef = useRef<Animation | null>(null);
  const pendingFilesFromHRef = useRef<number | null>(null);
  const filesExpandedRef = useRef(filesExpanded);
  filesExpandedRef.current = filesExpanded;

  // Built-in preview measured height & focus return refs
  const previewClipRef = useRef<HTMLDivElement | null>(null);
  const previewInnerRef = useRef<HTMLDivElement | null>(null);
  const previewAnimRef = useRef<Animation | null>(null);
  const pendingPreviewFromHRef = useRef<number | null>(null);
  const previewOpenRef = useRef(false);
  const lastPreviewIdxRef = useRef<number | null>(null);
  const fileBtnRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Track which task is currently open to reset disclosure cleanly on task change / reopen.
  const prevOpenKeyRef = useRef<string | null>(null);
  const currentOpenKey = isOpen && detail ? detail.key : null;

  useEffect(() => {
    if (!currentOpenKey) {
      prevOpenKeyRef.current = null;
      return;
    }
    if (prevOpenKeyRef.current !== currentOpenKey) {
      prevOpenKeyRef.current = currentOpenKey;
      descAnimRef.current?.cancel();
      descAnimRef.current = null;
      filesAnimRef.current?.cancel();
      filesAnimRef.current = null;
      previewAnimRef.current?.cancel();
      previewAnimRef.current = null;
      pendingDescFromHRef.current = null;
      pendingFilesFromHRef.current = null;
      pendingPreviewFromHRef.current = null;
      lastPreviewIdxRef.current = null;
      setDescExpanded(false);
      setFilesExpanded(false);
      setPreviewFileIdx(null);
      setRenderedPreviewIdx(null);
      if (scrollBodyRef.current) {
        scrollBodyRef.current.scrollTop = 0;
      }
    }
  }, [currentOpenKey]);

  // Keep description height cleanly locked when collapsed with expandable lines,
  // and animate smoothly with WAAPI on toggle / mid-flight reversal.
  useIsomorphicLayoutEffect(() => {
    const clipEl = descClipRef.current;
    const contentEl = descContentRef.current;
    const leadEl = leadBlockRef.current;
    if (!clipEl || !contentEl || !leadEl || !detail) return;

    if (!detail.hasExpandableDescription) {
      descAnimRef.current?.cancel();
      descAnimRef.current = null;
      pendingDescFromHRef.current = null;
      clipEl.style.height = "auto";
      return;
    }

    const collapsedH = Math.max(24, Math.ceil(leadEl.offsetHeight));
    const expandedH = Math.max(collapsedH, Math.ceil(contentEl.scrollHeight));
    const toH = descExpanded ? expandedH : collapsedH;

    const fromH = pendingDescFromHRef.current;
    pendingDescFromHRef.current = null;

    if (fromH === null) {
      descAnimRef.current?.cancel();
      descAnimRef.current = null;
      clipEl.style.height = descExpanded ? "auto" : `${collapsedH}px`;
      return;
    }

    if (prefersReducedMotion() || typeof clipEl.animate !== "function" || Math.abs(fromH - toH) < 1) {
      descAnimRef.current?.cancel();
      descAnimRef.current = null;
      clipEl.style.height = descExpanded ? "auto" : `${collapsedH}px`;
      return;
    }

    clipEl.style.height = `${toH}px`;
    const anim = clipEl.animate(
      [{ height: `${fromH}px` }, { height: `${toH}px` }],
      {
        duration: descExpanded ? 280 : 220,
        easing: descExpanded ? PANEL_EASING : EXIT_EASING,
      }
    );
    descAnimRef.current = anim;
    anim.onfinish = () => {
      if (descAnimRef.current !== anim) return;
      descAnimRef.current = null;
      if (descExpandedRef.current && descClipRef.current) {
        descClipRef.current.style.height = "auto";
      }
    };
  }, [descExpanded, detail?.key, detail?.hasExpandableDescription, isOpen]);

  // Keep collapsed description synchronized with responsive width changes when idle.
  useEffect(() => {
    if (!isOpen || !detail?.hasExpandableDescription || descExpanded) return;
    const leadEl = leadBlockRef.current;
    const clipEl = descClipRef.current;
    if (!leadEl || !clipEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (descAnimRef.current || descExpandedRef.current || !descClipRef.current || !leadBlockRef.current) return;
      descClipRef.current.style.height = `${Math.ceil(leadBlockRef.current.offsetHeight)}px`;
    });
    ro.observe(leadEl);
    return () => ro.disconnect();
  }, [isOpen, detail?.key, detail?.hasExpandableDescription, descExpanded]);

  // Animate files list disclosure container height cleanly & support mid-flight reversal.
  useIsomorphicLayoutEffect(() => {
    const clipEl = filesClipRef.current;
    const innerEl = filesInnerRef.current;
    if (!clipEl || !innerEl) return;

    if (!filesExpanded) {
      innerEl.setAttribute("inert", "");
    } else {
      innerEl.removeAttribute("inert");
    }

    const toH = filesExpanded ? Math.ceil(innerEl.scrollHeight) : 0;
    const fromH = pendingFilesFromHRef.current;
    pendingFilesFromHRef.current = null;

    if (fromH === null) {
      filesAnimRef.current?.cancel();
      filesAnimRef.current = null;
      clipEl.style.height = filesExpanded ? "auto" : "0px";
      return;
    }

    if (prefersReducedMotion() || typeof clipEl.animate !== "function" || Math.abs(fromH - toH) < 1) {
      filesAnimRef.current?.cancel();
      filesAnimRef.current = null;
      clipEl.style.height = filesExpanded ? "auto" : "0px";
      return;
    }

    clipEl.style.height = `${toH}px`;
    const anim = clipEl.animate(
      [{ height: `${fromH}px` }, { height: `${toH}px` }],
      {
        duration: filesExpanded ? 260 : 200,
        delay: filesExpanded ? 32 : 0,
        fill: filesExpanded ? "backwards" : "none",
        easing: filesExpanded ? PANEL_EASING : EXIT_EASING,
      }
    );
    filesAnimRef.current = anim;
    anim.onfinish = () => {
      if (filesAnimRef.current !== anim) return;
      filesAnimRef.current = null;
      if (filesExpandedRef.current && filesClipRef.current) {
        filesClipRef.current.style.height = "auto";
      }
    };
  }, [filesExpanded, detail?.key, isOpen, renderedPreviewIdx]);

  // Animate built-in file preview open/close cleanly and clean up rendered content after exit.
  const isPreviewOpen = previewFileIdx !== null && filesExpanded;
  previewOpenRef.current = isPreviewOpen;

  useIsomorphicLayoutEffect(() => {
    const clipEl = previewClipRef.current;
    const innerEl = previewInnerRef.current;
    if (!clipEl || !innerEl) return;

    const toH = isPreviewOpen ? Math.ceil(innerEl.scrollHeight) : 0;
    const fromH = pendingPreviewFromHRef.current;
    pendingPreviewFromHRef.current = null;

    if (fromH === null) {
      previewAnimRef.current?.cancel();
      previewAnimRef.current = null;
      clipEl.style.height = isPreviewOpen ? "auto" : "0px";
      return;
    }

    if (prefersReducedMotion() || typeof clipEl.animate !== "function" || Math.abs(fromH - toH) < 1) {
      previewAnimRef.current?.cancel();
      previewAnimRef.current = null;
      clipEl.style.height = isPreviewOpen ? "auto" : "0px";
      if (!isPreviewOpen) setRenderedPreviewIdx(null);
      return;
    }

    clipEl.style.height = `${toH}px`;
    const anim = clipEl.animate(
      [{ height: `${fromH}px` }, { height: `${toH}px` }],
      {
        duration: isPreviewOpen ? 240 : 190,
        easing: isPreviewOpen ? PANEL_EASING : EXIT_EASING,
      }
    );
    previewAnimRef.current = anim;
    anim.onfinish = () => {
      if (previewAnimRef.current !== anim) return;
      previewAnimRef.current = null;
      if (!previewOpenRef.current) {
        setRenderedPreviewIdx(null);
      } else if (previewClipRef.current) {
        previewClipRef.current.style.height = "auto";
      }
    };
  }, [isPreviewOpen, renderedPreviewIdx]);

  if (!detail) return null;

  const handleToggleDescription = () => {
    const clipEl = descClipRef.current;
    if (clipEl) {
      pendingDescFromHRef.current = clipEl.getBoundingClientRect().height;
      descAnimRef.current?.cancel();
      descAnimRef.current = null;
    }
    setDescExpanded((prev) => !prev);
  };

  const handleToggleFiles = () => {
    const clipEl = filesClipRef.current;
    if (clipEl) {
      pendingFilesFromHRef.current = clipEl.getBoundingClientRect().height;
      filesAnimRef.current?.cancel();
      filesAnimRef.current = null;
    }
    setFilesExpanded((prev) => {
      const next = !prev;
      if (!next && previewFileIdx !== null) {
        pendingPreviewFromHRef.current = previewClipRef.current?.getBoundingClientRect().height ?? 0;
        previewAnimRef.current?.cancel();
        previewAnimRef.current = null;
        setPreviewFileIdx(null);
      }
      return next;
    });
  };

  const handleOpenPreview = (idx: number) => {
    if (filesAnimRef.current && filesClipRef.current) {
      filesAnimRef.current.cancel();
      filesAnimRef.current = null;
      filesClipRef.current.style.height = "auto";
    }
    const clipEl = previewClipRef.current;
    if (clipEl) {
      pendingPreviewFromHRef.current = clipEl.getBoundingClientRect().height;
      previewAnimRef.current?.cancel();
      previewAnimRef.current = null;
    }
    if (previewFileIdx === idx) {
      lastPreviewIdxRef.current = idx;
      setPreviewFileIdx(null);
      return;
    }
    lastPreviewIdxRef.current = idx;
    setRenderedPreviewIdx(idx);
    setPreviewFileIdx(idx);
  };

  const handleClosePreview = () => {
    const returnIdx = previewFileIdx ?? lastPreviewIdxRef.current;
    const clipEl = previewClipRef.current;
    if (clipEl) {
      pendingPreviewFromHRef.current = clipEl.getBoundingClientRect().height;
      previewAnimRef.current?.cancel();
      previewAnimRef.current = null;
    }
    setPreviewFileIdx(null);

    if (returnIdx !== null && typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        const targetBtn = fileBtnRefs.current[returnIdx];
        if (!targetBtn || !targetBtn.isConnected) return;
        try {
          targetBtn.focus({ preventScroll: true });
          targetBtn.scrollIntoView({
            block: "nearest",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
          });
        } catch {}
      });
    }
  };

  const handleToggleManualDone = () => {
    const nextDone = !detail.isManualDone;
    setTaskManualDone({ url: detail.url, id: detail.id }, nextDone);
    optionalToast?.showToast(
      nextDone ? "Перенесено у «Здано» (відмічено вручну)" : "Позначку здачі скасовано",
      nextDone ? "success" : "info"
    );
    if (nextDone) onClose();
  };

  const statusPillClass = detail.isDone
    ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
    : detail.isOverdue && isLinked
      ? "border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300"
      : detail.badgeTone === "urgent"
        ? "border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-300"
        : "border-sys-border bg-sys-bg text-sys-text-secondary";

  const activePreviewMaterial =
    renderedPreviewIdx !== null ? detail.materials[renderedPreviewIdx] ?? null : null;

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      maxWidth="34rem"
      maxHeight="88dvh"
      labelledBy={titleId}
    >
      <div
        data-testid="task-detail-modal"
        className="w-full max-h-[88dvh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card text-sys-text-primary shadow-2xl overflow-hidden pb-safe"
      >
        {/* Header */}
        <div className="bg-sys-surface border-b border-sys-border px-4 sm:px-5 pt-2.5 sm:pt-4 pb-3.5 shrink-0">
          <div className="mx-auto mb-2.5 h-1 w-9 rounded-full bg-sys-border/80 sm:hidden" aria-hidden="true" />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center rounded-md border border-sys-accent/25 bg-sys-accent/10 px-2 py-0.5 text-[11px] font-bold text-sys-accent">
                  {detail.subject}
                </span>
                <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${statusPillClass}`}>
                  {detail.statusText}
                </span>
                {detail.weightLabel && (
                  <span className="inline-flex items-center rounded-md border border-sys-border bg-sys-bg px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary tabular-nums">
                    {detail.weightLabel}
                  </span>
                )}
              </div>

              <h2
                id={titleId}
                className="text-base sm:text-lg font-bold text-sys-text-primary leading-snug break-words"
              >
                {detail.title}
              </h2>

              <div className="flex flex-wrap items-center gap-2 text-xs text-sys-text-secondary">
                {detail.teacher && (
                  <span className="inline-flex items-center gap-1.5">
                    <UserCheckIcon className="h-3.5 w-3.5 text-sys-text-muted shrink-0" />
                    <span>{detail.teacher}</span>
                  </span>
                )}
                {detail.teacher && detail.estimatedMinutes ? (
                  <span className="text-sys-text-muted">·</span>
                ) : null}
                {detail.estimatedMinutes && (
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <ClockIcon className="h-3.5 w-3.5 text-sys-text-muted shrink-0" />
                    <span>
                      ~{detail.estimatedMinutes} хв · {detail.workFormatLabel}
                    </span>
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Закрити вікно завдання"
              className="relative after:absolute after:-inset-1 after:content-[''] flex h-9 w-9 items-center justify-center rounded-xl border border-sys-border bg-sys-card text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary active:scale-95 transition-colors cursor-pointer shrink-0"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div
          ref={scrollBodyRef}
          className="flex-1 overflow-y-auto overscroll-contain bg-sys-card px-4 sm:px-5 py-4 space-y-4 custom-scrollbar"
        >
          {/* 1. Description Block with anchored top & smooth measured bottom reveal */}
          <section aria-labelledby={`${descRegionId}-heading`} className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h3
                id={`${descRegionId}-heading`}
                className="text-[11px] font-bold uppercase tracking-wider text-sys-text-muted"
              >
                Опис завдання
              </h3>
              {detail.isAiBrief && (
                <span className="inline-flex items-center rounded-md border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                  Стислий опис ШІ
                </span>
              )}
            </div>

            <div className="rounded-xl border border-sys-border/80 bg-sys-bg/75 p-3.5 sm:p-4">
              <div
                id={descRegionId}
                ref={descClipRef}
                data-expanded={descExpanded ? "true" : "false"}
                className="relative overflow-hidden"
              >
                <div ref={descContentRef} className="space-y-2.5 text-[13px] sm:text-sm leading-relaxed text-sys-text-primary">
                  <p ref={leadBlockRef} className="m-0 font-medium text-sys-text-primary">
                    {detail.leadSummary}
                  </p>

                  {detail.extendedParagraphs.map((para, idx) => (
                    <p key={idx} className="m-0 text-sys-text-secondary leading-relaxed">
                      {para}
                    </p>
                  ))}
                </div>

                {detail.hasExpandableDescription && (
                  <div
                    aria-hidden="true"
                    className={`pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-sys-bg to-transparent transition-opacity duration-200 ${
                      descExpanded ? "opacity-0" : "opacity-100"
                    }`}
                  />
                )}
              </div>

              {detail.hasExpandableDescription && (
                <div className="mt-2.5 pt-2 border-t border-sys-border/50 flex items-center justify-between [overflow-anchor:none]">
                  <button
                    type="button"
                    data-testid="toggle-task-description"
                    aria-expanded={descExpanded}
                    aria-controls={descRegionId}
                    onClick={handleToggleDescription}
                    className="spring-press inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card px-2.5 py-1 text-xs font-semibold text-sys-accent hover:border-sys-accent/45 hover:bg-sys-hover transition-colors cursor-pointer"
                  >
                    <span>{descExpanded ? "Згорнути опис" : "Показати повністю"}</span>
                    <ChevronDownIcon
                      className={`h-3.5 w-3.5 transition-transform duration-150 [transition-timing-function:var(--ease-desktop-panel)] ${
                        descExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </button>
                  <span className="text-[11px] text-sys-text-muted">
                    {descExpanded ? "Увесь текст розгорнуто" : "Є деталі виконання"}
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* 2. Files & Attachments Section */}
          {detail.materials.length > 0 && (
            <section aria-labelledby={`${filesRegionId}-heading`} className="rounded-xl border border-sys-border/80 bg-sys-bg/60 overflow-hidden">
              <button
                type="button"
                id={`${filesRegionId}-heading`}
                data-testid="toggle-task-files"
                aria-expanded={filesExpanded}
                aria-controls={filesRegionId}
                onClick={handleToggleFiles}
                className="flex w-full items-center justify-between gap-2.5 px-3.5 py-3 text-left hover:bg-sys-card/70 active:scale-[0.99] transition-[background-color,transform] duration-fast cursor-pointer select-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileTextIcon className="h-4 w-4 text-sys-accent shrink-0" />
                  <span className="text-xs sm:text-[13px] font-bold text-sys-text-primary truncate">
                    Файли та вкладення
                  </span>
                  <span className="inline-flex items-center rounded-full border border-sys-border bg-sys-card px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary shrink-0">
                    {formatMaterialCount(detail.materials.length)}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 text-xs font-semibold text-sys-accent">
                  <span>{filesExpanded ? "Сховати файли" : "Показати файли"}</span>
                  <ChevronDownIcon
                    className={`h-4 w-4 transition-transform duration-150 [transition-timing-function:var(--ease-desktop-panel)] ${
                      filesExpanded ? "rotate-180" : ""
                    }`}
                  />
                </div>
              </button>

              <div
                id={filesRegionId}
                ref={filesClipRef}
                data-open={filesExpanded ? "true" : "false"}
                className="overflow-hidden"
              >
                <div
                  ref={filesInnerRef}
                  aria-hidden={!filesExpanded}
                  className="border-t border-sys-border/60 p-3 space-y-2 bg-sys-card/45"
                >
                  <ul className="space-y-1.5">
                    {detail.materials.map((mat, idx) => {
                      const kindLabel = formatMaterialKindLabel(mat.kind);
                      const badgeStyle = KIND_BADGE_STYLES[mat.kind] ?? KIND_BADGE_STYLES.file;
                      const isPreviewed = previewFileIdx === idx;
                      return (
                        <li
                          key={`${mat.url || mat.title}-${idx}`}
                          className={`flex items-center justify-between gap-2 rounded-xl border transition-colors duration-fast ${
                            isPreviewed
                              ? "border-sys-accent/55 bg-sys-accent/[0.08]"
                              : "border-sys-border/80 bg-sys-card hover:border-sys-border-elevated"
                          }`}
                        >
                          <button
                            ref={(el) => {
                              fileBtnRefs.current[idx] = el;
                            }}
                            type="button"
                            data-testid={`task-file-item-${idx}`}
                            aria-expanded={isPreviewed}
                            onClick={() => handleOpenPreview(idx)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sys-accent rounded-l-xl"
                          >
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded-md border text-[10px] font-bold tracking-wide uppercase shrink-0 ${badgeStyle}`}
                            >
                              {kindLabel}
                            </span>
                            <span className="min-w-0 flex-1 text-xs sm:text-[13px] font-semibold text-sys-text-primary leading-snug [overflow-wrap:anywhere]">
                              {mat.title}
                            </span>
                            <span className="text-[11px] font-medium text-sys-accent shrink-0">
                              {isPreviewed ? "Згорнути" : "Перегляд"}
                            </span>
                          </button>

                          {mat.url && (
                            <a
                              href={mat.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => {
                                e.stopPropagation();
                                markPendingClassroomReturn();
                              }}
                              aria-label={`Відкрити або завантажити ${mat.title} у новій вкладці`}
                              title="Відкрити / завантажити в новій вкладці"
                              className="mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sys-border/70 bg-sys-bg text-sys-text-secondary hover:border-sys-accent/45 hover:text-sys-accent active:scale-95 transition-colors"
                            >
                              <span aria-hidden="true" className="text-xs font-bold">
                                ↗
                              </span>
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {/* Built-in attachment preview pane with measured height & focus restoration */}
                  <div ref={previewClipRef} className="overflow-hidden">
                    <div ref={previewInnerRef} aria-hidden={!isPreviewOpen}>
                      {activePreviewMaterial && (
                        <div
                          data-testid="task-file-preview-pane"
                          className="mt-1 rounded-xl border border-sys-accent/35 bg-sys-bg p-3.5 space-y-2.5"
                        >
                          <div className="flex items-start justify-between gap-2 border-b border-sys-border/60 pb-2">
                            <div className="min-w-0 flex-1">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-sys-accent block">
                                Вбудований перегляд · {formatMaterialKindLabel(activePreviewMaterial.kind)}
                              </span>
                              <h4 className="text-xs sm:text-sm font-bold text-sys-text-primary leading-snug mt-0.5 [overflow-wrap:anywhere]">
                                {activePreviewMaterial.title}
                              </h4>
                            </div>
                            <button
                              type="button"
                              data-testid="close-file-preview"
                              onClick={handleClosePreview}
                              className="shrink-0 rounded-lg border border-sys-border bg-sys-card px-2.5 py-1 text-[11px] font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 active:scale-95 transition-colors cursor-pointer"
                            >
                              Закрити перегляд
                            </button>
                          </div>

                          <div className="space-y-1.5 text-xs text-sys-text-secondary leading-relaxed">
                            {getAttachmentPreviewLines(activePreviewMaterial, detail).map((line, lineIdx) => (
                              <p key={lineIdx} className="m-0">
                                {line}
                              </p>
                            ))}
                          </div>

                          {activePreviewMaterial.url && (
                            <div className="pt-1 flex justify-end">
                              <a
                                href={activePreviewMaterial.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={markPendingClassroomReturn}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-sys-accentSolid px-3 py-1.5 text-xs font-semibold text-sys-onAccent hover:opacity-95 active:scale-95 transition-opacity"
                              >
                                <span>Відкрити оригінал</span>
                                <span aria-hidden="true">↗</span>
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="shrink-0 border-t border-sys-border bg-sys-surface px-4 sm:px-5 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isLinked && (detail.isOverdue || detail.isManualDone) && (
              <button
                type="button"
                onClick={handleToggleManualDone}
                className={`inline-flex items-center gap-1.5 min-h-[36px] rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer active:scale-95 ${
                  detail.isManualDone
                    ? "border-sys-border bg-sys-card text-sys-text-secondary hover:border-rose-500/40 hover:text-rose-700 dark:hover:text-rose-300"
                    : "border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-500/20"
                }`}
              >
                <CheckIcon className="h-3.5 w-3.5 shrink-0" />
                <span>{detail.isManualDone ? "Скасувати здачу" : "Позначити зданим"}</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <a
              href={detail.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={markPendingClassroomReturn}
              className="inline-flex items-center gap-1.5 min-h-[36px] rounded-xl bg-sys-accentSolid px-3.5 py-1.5 text-xs font-semibold text-sys-onAccent hover:opacity-95 active:scale-95 transition-opacity"
            >
              <span>Відкрити в Classroom</span>
              <span aria-hidden="true">↗</span>
            </a>

            <button
              type="button"
              onClick={onClose}
              className="min-h-[36px] rounded-xl border border-sys-border bg-sys-card px-3.5 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg active:scale-95 transition-colors cursor-pointer"
            >
              Закрити
            </button>
          </div>
        </div>
      </div>
    </AppDialog>
  );
}
