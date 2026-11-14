"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReferenceRecord } from "../../lib/api";
import { getGroupCourse } from "../../lib/groupInfo";
import { filterAndRankEntities, getGroupSearchBadge } from "../../lib/quickJump";
import { RecentSelectionsChips } from "../RecentSelectionsChips";
import { AppDialog } from "../ui/AppDialog";
import { CheckIcon, CloseIcon } from "../ui/Icons";

interface ContextSelectionModalProps {
  isOpen: boolean;
  mode: "student" | "teacher";
  isDesktop: boolean;
  groups: ReferenceRecord[];
  teachers: ReferenceRecord[];
  groupId: number | null;
  teacherId: number | null;
  recentGroupIds: number[];
  recentTeacherIds: number[];
  onClose: () => void;
  onSelect: (tab: "student" | "teacher", id: number) => void;
}

export function ContextSelectionModal({
  isOpen,
  mode,
  isDesktop,
  groups,
  teachers,
  groupId,
  teacherId,
  recentGroupIds,
  recentTeacherIds,
  onClose,
  onSelect,
}: ContextSelectionModalProps) {
  const [modalTab, setModalTab] = useState<"student" | "teacher">(mode);
  const [tabSlideDir, setTabSlideDir] = useState<"next" | "prev" | null>(null);
  const [modalSearch, setModalSearch] = useState("");
  const [modalCourseFilter, setModalCourseFilter] = useState<number | null>(null);
  const [modalHighlightedIndex, setModalHighlightedIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setModalTab(mode);
      setTabSlideDir(null);
      setModalSearch("");
      setModalCourseFilter(null);
      setModalHighlightedIndex(0);
      if (isDesktop) {
        const id = window.requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => window.cancelAnimationFrame(id);
      }
    }
  }, [isOpen, mode, isDesktop]);

  const handleTabSwitch = (nextTab: "student" | "teacher") => {
    if (nextTab !== modalTab) {
      setTabSlideDir(nextTab === "teacher" ? "next" : "prev");
      setModalTab(nextTab);
    }
    setModalSearch("");
    setModalCourseFilter(null);
  };

  const filteredModalOptions = useMemo(() => {
    const baseList =
      modalTab === "student"
        ? modalCourseFilter === null
          ? groups
          : groups.filter((g) => (g.course ?? getGroupCourse(g.name)) === modalCourseFilter)
        : teachers;
    return filterAndRankEntities(baseList, modalSearch, modalTab);
  }, [modalTab, groups, teachers, modalSearch, modalCourseFilter]);

  useEffect(() => {
    setModalHighlightedIndex(0);
  }, [modalSearch, modalTab, modalCourseFilter]);

  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const item = filteredModalOptions[modalHighlightedIndex];
    if (!item) return;
    const el = document.getElementById(`context-modal-opt-${modalTab}-${item.id}`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [modalHighlightedIndex, isOpen, filteredModalOptions, modalTab]);

  const handleSelectOption = (tab: "student" | "teacher", id: number) => {
    onSelect(tab, id);
    onClose();
  };

  return (
    <AppDialog
      isOpen={isOpen}
      onClose={onClose}
      variant="sheet"
      maxWidth="448px"
      labelledBy="context-modal-title"
    >
      <div className="w-full rounded-t-3xl sm:rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 pb-safe shadow-2xl h-[min(78dvh,500px)] flex flex-col overflow-hidden">
            <div className="mx-auto mb-2.5 h-1.5 w-10 rounded-full bg-sys-border sm:hidden shrink-0" aria-hidden="true" />
            <h2 id="context-modal-title" className="sr-only">
              Оберіть групу або викладача
            </h2>
            {/* Header with tabs */}
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-sys-border/60 shrink-0">
              <div
                role="tablist"
                aria-label="Режим пошуку"
                className="relative grid grid-cols-2 rounded-xl border border-sys-border bg-sys-bg p-1 flex-1 isolate select-none"
              >
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1 bottom-1 left-1 z-0 rounded-lg bg-sys-accentSolid shadow-xs transform-gpu transition-transform duration-base [transition-timing-function:var(--ease-spring-snappy)]"
                  style={{
                    width: "calc((100% - 8px) / 2)",
                    transform: `translate3d(${modalTab === "teacher" ? "100%" : "0%"}, 0, 0)`,
                  }}
                />
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === "student"}
                  onClick={() => handleTabSwitch("student")}
                  className={`relative z-10 h-9 rounded-lg text-xs font-semibold transition-colors duration-fast ease-smooth cursor-pointer ${
                    modalTab === "student" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Групи ({groups.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={modalTab === "teacher"}
                  onClick={() => handleTabSwitch("teacher")}
                  className={`relative z-10 h-9 rounded-lg text-xs font-semibold transition-colors duration-fast ease-smooth cursor-pointer ${
                    modalTab === "teacher" ? "text-white font-bold" : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  Викладачі ({teachers.length})
                </button>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Закрити"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg transition-colors"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            {/* Search Input */}
            <search className="mt-3 relative block shrink-0">
              <input
                ref={searchInputRef}
                type="search"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label={modalTab === "student" ? "Пошук групи" : "Пошук викладача"}
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setModalHighlightedIndex((i) =>
                      filteredModalOptions.length > 0 ? Math.min(i + 1, filteredModalOptions.length - 1) : 0
                    );
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setModalHighlightedIndex((i) => Math.max(i - 1, 0));
                  } else if (e.key === "Enter" && filteredModalOptions.length > 0) {
                    e.preventDefault();
                    const chosen = filteredModalOptions[modalHighlightedIndex] ?? filteredModalOptions[0];
                    if (chosen) handleSelectOption(modalTab, chosen.id);
                  } else if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    e.preventDefault();
                    setModalTab((prev) => (prev === "student" ? "teacher" : "student"));
                    setModalCourseFilter(null);
                  }
                }}
                placeholder={modalTab === "student" ? "Пошук групи, шифру (КІ-24) або курсу..." : "Пошук викладача..."}
                className="w-full h-10 rounded-xl border border-sys-border bg-sys-bg pl-3.5 pr-10 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:border-sys-accent focus:ring-2 focus:ring-sys-accent focus:outline-none"
              />
              {modalSearch && (
                <button
                  type="button"
                  onClick={() => {
                    setModalSearch("");
                    if (isDesktop) searchInputRef.current?.focus();
                  }}
                  aria-label="Очистити пошук"
                  className="absolute right-0.5 top-1/2 -translate-y-1/2 flex h-10 w-10 items-center justify-center rounded-lg text-sys-text-muted hover:text-sys-text-primary transition-colors"
                >
                  <CloseIcon className="h-4 w-4" />
                </button>
              )}
            </search>

            {/* Course filter chips for groups */}
            {modalTab === "student" && (
              <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto pb-1 shrink-0 no-scrollbar" role="group" aria-label="Фільтр за курсом">
                {([null, 1, 2, 3, 4] as const).map((course) => {
                  const active = modalCourseFilter === course;
                  return (
                    <button
                      key={course ?? "all"}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setModalCourseFilter(course)}
                      className={`shrink-0 rounded-xl px-2.5 py-1 text-xs font-semibold border transition-colors ${
                        active
                          ? "bg-sys-accent text-white border-sys-accent shadow-xs"
                          : "bg-sys-bg border-sys-border text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40"
                      }`}
                    >
                      {course === null ? "Всі" : `${course} курс`}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Recent selections */}
            {!modalSearch.trim() && (
              <div className="shrink-0">
                <RecentSelectionsChips
                  mode={modalTab}
                  currentId={modalTab === "student" ? groupId : teacherId}
                  recentIds={modalTab === "student" ? recentGroupIds : recentTeacherIds}
                  options={modalTab === "student" ? groups : teachers}
                  onSelect={(id) => handleSelectOption(modalTab, id)}
                />
              </div>
            )}

            {/* List of items */}
            <div
              role="listbox"
              className="mt-2.5 flex-1 min-h-0 overflow-y-auto overflow-x-clip [scrollbar-gutter:stable] overscroll-contain custom-scrollbar pr-1 pb-2"
            >
              <div
                key={modalTab}
                data-slide-dir={tabSlideDir ?? undefined}
                className={`guide-step-slide ${
                  modalTab === "student" ? "grid grid-cols-2 sm:grid-cols-3 gap-2 content-start" : "space-y-1"
                }`}
              >
              {filteredModalOptions.map((opt, idx) => {
                const isSelected = modalTab === "student" ? opt.id === groupId : opt.id === teacherId;
                const isHighlighted = idx === modalHighlightedIndex;
                const groupBadge = modalTab === "student" ? getGroupSearchBadge(opt) : null;
                return (
                  <button
                    key={`${modalTab}-${opt.id}`}
                    id={`context-modal-opt-${modalTab}-${opt.id}`}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setModalHighlightedIndex(idx)}
                    onClick={() => handleSelectOption(modalTab, opt.id)}
                    className={
                      modalTab === "student"
                        ? `w-full text-left px-3 py-2.5 rounded-xl text-xs transition-colors flex flex-col justify-between border ${
                            isSelected
                              ? "bg-sys-accent/15 text-sys-accent font-semibold border-sys-accent/50 shadow-xs"
                              : isHighlighted
                                ? "bg-sys-accent/10 text-sys-text-primary border-sys-accent/40"
                                : "bg-sys-bg/60 text-sys-text-primary border-sys-border/70 hover:bg-sys-bg hover:border-sys-accent/30"
                          }`
                        : `w-full text-left px-3.5 py-2.5 rounded-xl text-sm transition-colors flex items-center justify-between border ${
                            isSelected
                              ? "bg-sys-accent/15 text-sys-accent font-semibold border-sys-accent/30"
                              : isHighlighted
                                ? "bg-sys-accent/10 text-sys-text-primary border-sys-accent/30"
                                : "border-transparent text-sys-text-primary hover:bg-sys-bg"
                          }`
                    }
                  >
                    <div className="flex items-center justify-between gap-1.5 w-full min-w-0">
                      <span
                        className={`font-bold text-sm leading-snug ${
                          modalTab === "teacher" ? "break-words text-left min-w-0" : "truncate"
                        }`}
                      >
                        {opt.name}
                      </span>
                      {isSelected && <CheckIcon className="h-3.5 w-3.5 shrink-0 text-sys-accent" />}
                    </div>
                    {groupBadge && groupBadge !== opt.name && (
                      <span className="mt-0.5 text-[10px] text-sys-text-muted line-clamp-2 leading-tight break-words block">
                        {groupBadge}
                      </span>
                    )}
                  </button>
                );
              })}
              {filteredModalOptions.length === 0 && (
                <p className="col-span-full text-center py-6 text-xs text-sys-text-muted" role="status">
                  Нічого не знайдено
                </p>
              )}
              </div>
            </div>
      </div>
    </AppDialog>
  );
}
