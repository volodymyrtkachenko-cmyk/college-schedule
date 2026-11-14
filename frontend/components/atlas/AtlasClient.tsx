"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useReducedMotion } from "framer-motion";
import { api } from "@/lib/api";
import type { AtlasResponse } from "@/lib/api/types";
import { readCacheSnapshot, writeCacheSnapshot } from "@/lib/cacheSnapshot";
import { useTheme } from "@/lib/useTheme";
import { toTeacherSlug } from "@/lib/slug";
import { SubpageHeader } from "@/components/navigation/SubpageHeader";
import { AtlasCanvas } from "@/components/atlas/AtlasCanvas";
import {
  buildAtlasGraph,
  compareAtlasLabels,
  computeNodeIntersection,
  filterAtlasRelationRows,
  getCompareCandidates,
  getNodeInspectorData,
  makeAtlasNodeId,
  sortAtlasRelationRows,
  type AtlasCompareScope,
  type AtlasGraph,
  type AtlasGraphNode,
  type AtlasIntersectionResult,
  type AtlasNodeInspectorData,
  type AtlasNodeKind,
  type AtlasRelationRow,
  type AtlasRelationSortKey,
} from "@/lib/atlas/graphEngine";
import {
  BarChartIcon,
  BookOpenIcon,
  BuildingIcon,
  CalendarIcon,
  CloseIcon,
  DoorOpenIcon,
  GraduationCapIcon,
  InfoIcon,
  NetworkIcon,
  SearchIcon,
  SlidersIcon,
  UsersIcon,
} from "@/components/ui/Icons";

const ATLAS_CACHE_KEY = "atlas:graph:v1";

const DAY_SHORT_NAMES: Record<number, string> = {
  1: "Пн",
  2: "Вт",
  3: "Ср",
  4: "Чт",
  5: "Пт",
  6: "Сб",
  7: "Нд",
};

const SORT_LABELS: Record<AtlasRelationSortKey, string> = {
  lessons: "За парами",
  alpha: "За назвою (А–Я)",
  course: "За курсом і кодом",
  room: "За кабінетом",
  day: "За днями тижня",
};

type MobileWorkspaceView = "split" | "map" | "list";
type InspectorTabKey = "primary" | "subjects" | "rooms";
type CompareFilterTab = "all" | "shared" | "diff" | "meta";

const KIND_META: Record<
  AtlasNodeKind,
  {
    singular: string;
    plural: string;
    pillClass: string;
    dotClass: string;
    accentTextClass: string;
  }
> = {
  group: {
    singular: "Група",
    plural: "Групи",
    pillClass:
      "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dotClass: "bg-sys-accent",
    accentTextClass: "text-blue-700 dark:text-blue-300",
  },
  teacher: {
    singular: "Викладач",
    plural: "Викладачі",
    pillClass:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
    dotClass: "bg-emerald-500",
    accentTextClass: "text-emerald-700 dark:text-emerald-300",
  },
  subject: {
    singular: "Предмет",
    plural: "Предмети",
    pillClass:
      "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    dotClass: "bg-violet-500",
    accentTextClass: "text-violet-700 dark:text-violet-300",
  },
  room: {
    singular: "Аудиторія",
    plural: "Аудиторії",
    pillClass:
      "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300",
    dotClass: "bg-amber-500",
    accentTextClass: "text-amber-800 dark:text-amber-300",
  },
};

function KindIcon({ kind, className = "w-4 h-4" }: { kind: AtlasNodeKind; className?: string }) {
  if (kind === "group") return <UsersIcon className={className} />;
  if (kind === "teacher") return <GraduationCapIcon className={className} />;
  if (kind === "subject") return <BookOpenIcon className={className} />;
  return <DoorOpenIcon className={className} />;
}

function formatPairsLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} пара`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} пари`;
  return `${count} пар`;
}

function reorderDomElements(container: HTMLElement, orderedElements: HTMLElement[]) {
  const canMoveBefore =
    typeof Element !== "undefined" &&
    Object.prototype.hasOwnProperty.call(Element.prototype, "moveBefore");
  for (const el of orderedElements) {
    if (el.parentElement !== container) continue;
    if (canMoveBefore) {
      (container as unknown as { moveBefore: (node: Node, child: Node | null) => void }).moveBefore(
        el,
        null,
      );
    } else {
      container.append(el);
    }
  }
}

interface AtlasSearchCandidate {
  node: AtlasGraphNode;
  matchHint: string | null;
  score: number;
}

function searchAtlasNodes(
  graph: AtlasGraph,
  query: string,
  options?: {
    excludeId?: string | null;
    limit?: number;
    onlyConnected?: boolean;
    preferredCourse?: number | null;
  },
): AtlasSearchCandidate[] {
  const needle = query.trim().toLowerCase();
  const limit = options?.limit ?? 30;
  const excludeId = options?.excludeId ?? null;
  const onlyConnected = options?.onlyConnected ?? false;
  const preferredCourse = options?.preferredCourse ?? null;

  const bestByNodeId = new Map<string, AtlasSearchCandidate>();

  const register = (node: AtlasGraphNode, score: number, matchHint: string | null) => {
    if (excludeId && node.id === excludeId) return;
    if (onlyConnected && !node.isConnected) return;
    const weightedScore = score + (node.isConnected ? 5 : 0);
    const existing = bestByNodeId.get(node.id);
    if (!existing || weightedScore > existing.score) {
      bestByNodeId.set(node.id, { node, matchHint, score: weightedScore });
    }
  };

  for (const node of graph.nodes) {
    if (!needle) {
      let baseScore = node.kind === "group" ? 200 : 10;
      if (node.kind === "group" && preferredCourse !== null && node.course === preferredCourse) {
        baseScore += 100;
      }
      register(node, baseScore, null);
      continue;
    }

    const labelLow = node.label.toLowerCase();
    const shortLow = node.shortLabel.toLowerCase();
    const fullLow = (node.fullName ?? "").toLowerCase();
    const subLow = (node.subtitle ?? "").toLowerCase();

    let score = 0;
    if (labelLow === needle || shortLow === needle) score = 100;
    else if (labelLow.startsWith(needle) || shortLow.startsWith(needle)) score = 70;
    else if (fullLow.startsWith(needle)) score = 60;
    else if (labelLow.includes(needle) || shortLow.includes(needle)) score = 40;
    else if (fullLow.includes(needle) || subLow.includes(needle)) score = 20;

    if (score > 0) {
      register(node, score, null);
    }
  }

  // Also resolve matching subjects & rooms from raw catalog to their linked Groups / Teachers
  if (needle) {
    const matchedSubjects = new Map<number, string>();
    for (const s of Array.from(graph.subjectsRaw.values())) {
      const nameLow = s.name.toLowerCase();
      const shortLow = (s.short_name ?? "").toLowerCase();
      if (nameLow.includes(needle) || (shortLow && shortLow.includes(needle))) {
        matchedSubjects.set(s.id, s.name);
      }
    }

    const matchedRooms = new Set<string>();
    for (const r of Array.from(graph.roomsRaw.values())) {
      if (r.name.toLowerCase().includes(needle)) {
        matchedRooms.add(r.id);
      }
    }

    if (matchedSubjects.size > 0 || matchedRooms.size > 0) {
      for (const edge of graph.edgesRaw) {
        const subjMatch = matchedSubjects.get(edge.subject_id);
        const roomMatch = edge.room && matchedRooms.has(edge.room) ? edge.room : null;
        if (!subjMatch && !roomMatch) continue;

        const hint = subjMatch ? `Предмет: ${subjMatch}` : `Ауд. ${roomMatch}`;
        const gNode = graph.nodeMap.get(makeAtlasNodeId("group", edge.group_id));
        if (gNode) register(gNode, 18, hint);

        const tIds = edge.second_teacher_id
          ? [edge.teacher_id, edge.second_teacher_id]
          : [edge.teacher_id];
        for (const tid of tIds) {
          const tNode = graph.nodeMap.get(makeAtlasNodeId("teacher", tid));
          if (tNode) register(tNode, 16, hint);
        }
      }

      if (matchedRooms.size > 0) {
        for (const t of Array.from(graph.teachersRaw.values())) {
          if (t.room && matchedRooms.has(t.room)) {
            const tNode = graph.nodeMap.get(makeAtlasNodeId("teacher", t.id));
            if (tNode) register(tNode, 19, `Закріплений каб. ${t.room}`);
          }
        }
      }
    }
  }

  return Array.from(bestByNodeId.values())
    .sort((a, b) => {
      if (!needle) {
        if (a.node.kind !== b.node.kind) return a.node.kind === "group" ? -1 : 1;
        if (b.score !== a.score) return b.score - a.score;
        if (a.node.kind === "group" && b.node.kind === "group") {
          const ca = a.node.course ?? 99;
          const cb = b.node.course ?? 99;
          if (ca !== cb) return ca - cb;
          return compareAtlasLabels(a.node.label, b.node.label);
        }
        if (b.node.lessonsCount !== a.node.lessonsCount) {
          return b.node.lessonsCount - a.node.lessonsCount;
        }
        return compareAtlasLabels(a.node.label, b.node.label);
      }
      if (b.score !== a.score) return b.score - a.score;
      if (b.node.lessonsCount !== a.node.lessonsCount) return b.node.lessonsCount - a.node.lessonsCount;
      return compareAtlasLabels(a.node.label, b.node.label);
    })
    .slice(0, limit);
}

function getScheduleHref(node: AtlasGraphNode): string | null {
  if (node.kind === "group") {
    return `/group/${encodeURIComponent(node.label)}`;
  }
  if (node.kind === "teacher") {
    return `/teacher/${toTeacherSlug(node.label)}`;
  }
  return null;
}

function CompareNodePicker({
  graph,
  baseNode,
  activeCompareId,
  onPickNode,
  onClose,
}: {
  graph: AtlasGraph;
  baseNode: AtlasGraphNode;
  activeCompareId: string | null;
  onPickNode: (nodeId: string) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<AtlasCompareScope>("recommended");
  const inputId = useId();

  const candidates = useMemo(
    () =>
      getCompareCandidates(graph, baseNode.id, {
        query,
        scope,
        limit: 24,
      }),
    [graph, baseNode.id, query, scope],
  );

  const recommendedLabel =
    baseNode.kind === "group"
      ? baseNode.course
        ? `${baseNode.course} курс і близькі`
        : "Близькі групи"
      : "Колеги за групами";

  return (
    <div className="rounded-xl border border-sys-border bg-sys-bg p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="block text-xs font-semibold text-sys-text-primary">
          Оберіть другий вузол для порівняння з {baseNode.label}
        </label>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити вибір для порівняння"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-text-primary cursor-pointer"
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Scope Filter Pills */}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Категорія для порівняння">
        {(
          [
            { key: "recommended", label: recommendedLabel },
            { key: "groups", label: "Усі групи" },
            { key: "teachers", label: "Викладачі" },
          ] as Array<{ key: AtlasCompareScope; label: string }>
        ).map((item) => {
          const active = scope === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => setScope(item.key)}
              className={`min-h-[28px] rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors cursor-pointer ${
                active
                  ? "border-sys-accent bg-sys-accent text-white"
                  : "border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Search Input */}
      <div className="relative flex items-center">
        <SearchIcon className="w-3.5 h-3.5 text-sys-text-muted pointer-events-none absolute left-2.5" />
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Пошук групи або прізвища викладача..."
          className="w-full min-h-[36px] rounded-xl border border-sys-border bg-sys-card pl-8 pr-8 py-1.5 text-xs sm:text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Очистити фільтр порівняння"
            className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-text-primary cursor-pointer"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        )}
      </div>

      {/* Candidate Chips */}
      <div className="flex flex-wrap gap-1.5 max-h-44 overflow-y-auto pr-0.5">
        {candidates.map(({ node: cand, reasonHint }) => {
          const cMeta = KIND_META[cand.kind];
          const isCurrent = cand.id === activeCompareId;
          return (
            <button
              key={cand.id}
              type="button"
              onClick={() => onPickNode(cand.id)}
              className={`min-h-[32px] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                isCurrent
                  ? "border-amber-500/60 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                  : "border-sys-border bg-sys-card hover:border-sys-accent/55 text-sys-text-primary"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${cMeta.dotClass}`} aria-hidden="true" />
              <span className="font-semibold">{cand.label}</span>
              {reasonHint && (
                <span className="text-[10px] text-sys-text-muted font-normal">
                  {reasonHint}
                </span>
              )}
            </button>
          );
        })}
        {candidates.length === 0 && (
          <p className="text-xs text-sys-text-muted py-1">
            За цим фільтром вузлів не знайдено. Спробуйте перемкнути вкладку вище.
          </p>
        )}
      </div>
    </div>
  );
}

function SortControlStrip({
  sortBy,
  availableSorts,
  onSortChange,
}: {
  sortBy: AtlasRelationSortKey;
  availableSorts: AtlasRelationSortKey[];
  onSortChange: (next: AtlasRelationSortKey) => void;
}) {
  const shortLabels: Record<AtlasRelationSortKey, string> = {
    lessons: "За парами",
    alpha: "А–Я",
    course: "Курс",
    room: "Кабінет",
    day: "Дні",
  };

  return (
    <div
      role="group"
      aria-label="Сортування списку"
      className="flex flex-wrap items-center gap-1"
    >
      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sys-text-muted mr-0.5">
        <SlidersIcon className="w-3 h-3" />
        <span className="sr-only sm:not-sr-only">Сортувати:</span>
      </span>
      {availableSorts.map((key) => {
        const active = sortBy === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            title={SORT_LABELS[key]}
            onClick={() => onSortChange(key)}
            className={`min-h-[28px] rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              active
                ? "border-sys-accent/50 bg-sys-accent/12 text-sys-accent"
                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            {shortLabels[key]}
          </button>
        );
      })}
    </div>
  );
}

function RelationListSection({
  title,
  kind,
  rows,
  sortBy,
  filterQuery,
  onSelectNode,
  onQuickCompareNode,
  onPickSearchTerm,
}: {
  title: string;
  kind: AtlasNodeKind;
  rows: AtlasRelationRow[];
  sortBy: AtlasRelationSortKey;
  filterQuery: string;
  onSelectNode: (nodeId: string) => void;
  onQuickCompareNode?: (nodeId: string) => void;
  onPickSearchTerm?: (term: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const listRef = useRef<HTMLUListElement | null>(null);

  const processedRows = useMemo(() => {
    const filtered = filterAtlasRelationRows(rows, filterQuery);
    return sortAtlasRelationRows(filtered, sortBy);
  }, [rows, filterQuery, sortBy]);

  const limit = 12;
  const visibleRows = expanded ? processedRows : processedRows.slice(0, limit);
  const hiddenCount = Math.max(0, processedRows.length - limit);
  const meta = KIND_META[kind];
  const isNavigableNode = kind === "group" || kind === "teacher";

  // Keep DOM element order synchronized via moveBefore/append when sorting changes
  useEffect(() => {
    const listEl = listRef.current;
    if (!listEl) return;
    const childMap = new Map<string, HTMLElement>();
    for (const child of Array.from(listEl.children)) {
      if (child instanceof HTMLElement && child.dataset.rowId) {
        childMap.set(child.dataset.rowId, child);
      }
    }
    const ordered = visibleRows
      .map((r) => childMap.get(r.node.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (ordered.length > 1) {
      reorderDomElements(listEl, ordered);
    }
  }, [visibleRows, sortBy]);

  if (rows.length === 0) return null;

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sys-text-secondary [text-wrap:balance]">
          <span className={`inline-block h-2 w-2 rounded-full ${meta.dotClass}`} aria-hidden="true" />
          <span>{title}</span>
        </h3>
        <span className="rounded-md bg-sys-bg px-1.5 py-0.5 text-[11px] font-semibold text-sys-text-muted tabular-nums">
          {processedRows.length !== rows.length
            ? `${processedRows.length} з ${rows.length}`
            : rows.length}
        </span>
      </div>

      {processedRows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-sys-border bg-sys-bg/40 px-3 py-3 text-center text-xs text-sys-text-muted">
          За фільтром «{filterQuery}» збігів у цьому списку немає.
        </p>
      ) : (
        <ul ref={listRef} role="list" className="space-y-2">
          {visibleRows.map((row) => {
            const daysText = row.days.map((d) => DAY_SHORT_NAMES[d] ?? String(d)).join(", ");
            const subjectsText = row.subjects.join(" · ");
            const tagsText = !subjectsText && row.tags.length > 0 ? row.tags.join(" · ") : "";
            const roomsText = row.rooms.map((r) => `каб. ${r}`).join(", ");
            const showFullNameHint =
              Boolean(row.node.fullName) && row.node.fullName !== row.node.label;
            const showCourseBadge = row.node.kind === "group" && row.node.course !== null;
            const showFloorBadge = row.node.kind === "room" && row.node.floor !== null;

            return (
              <li
                key={row.node.id}
                data-row-id={row.node.id}
                className="flex items-stretch gap-1.5"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (isNavigableNode) {
                      onSelectNode(row.node.id);
                    } else if (onPickSearchTerm) {
                      onPickSearchTerm(row.node.label);
                    }
                  }}
                  title={
                    isNavigableNode
                      ? `Перейти до орбіти: ${row.node.fullName || row.node.label}`
                      : `Знайти всі зв'язки: ${row.node.label}`
                  }
                  className="flex-1 min-w-0 min-h-[44px] rounded-xl border border-sys-border bg-sys-bg/65 hover:bg-sys-bg hover:border-sys-accent/45 px-3 py-2.5 text-left transition-colors cursor-pointer flex items-start justify-between gap-2.5 group"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors break-words">
                        {row.node.label}
                      </span>
                      {showFullNameHint && (
                        <span className="text-xs text-sys-text-muted font-normal break-words">
                          ({row.node.fullName})
                        </span>
                      )}
                      {showCourseBadge && (
                        <span className="inline-flex items-center rounded-md border border-sys-border bg-sys-card px-1.5 py-0.5 text-[10px] font-semibold text-sys-text-secondary">
                          {row.node.course} курс
                        </span>
                      )}
                      {showFloorBadge && (
                        <span className="inline-flex items-center rounded-md border border-sys-border bg-sys-card px-1.5 py-0.5 text-[10px] font-semibold text-sys-text-secondary">
                          {row.node.floor} поверх
                        </span>
                      )}
                      {row.badge && (
                        <span className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300">
                          {row.badge}
                        </span>
                      )}
                    </div>
                    {(subjectsText || tagsText) && (
                      <p className="text-xs text-sys-text-secondary leading-relaxed break-words [text-wrap:pretty]">
                        {subjectsText || tagsText}
                      </p>
                    )}
                    {(roomsText || daysText) && (
                      <p className="text-[11px] text-sys-text-muted break-words">
                        {roomsText}
                        {roomsText && daysText ? " · " : ""}
                        {daysText}
                      </p>
                    )}
                  </div>
                  {row.lessonsCount > 0 && (
                    <span className="shrink-0 rounded-lg border border-sys-border bg-sys-card px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary tabular-nums">
                      {formatPairsLabel(row.lessonsCount)}
                    </span>
                  )}
                </button>

                {isNavigableNode && onQuickCompareNode && (
                  <button
                    type="button"
                    onClick={() => onQuickCompareNode(row.node.id)}
                    aria-label={`Порівняти перетин з ${row.node.label}`}
                    title={`Порівняти перетин з ${row.node.label}`}
                    className="shrink-0 min-w-[38px] min-h-[44px] inline-flex items-center justify-center rounded-xl border border-sys-border bg-sys-bg/65 hover:bg-amber-500/10 hover:border-amber-500/45 text-xs font-semibold text-sys-text-muted hover:text-amber-800 dark:hover:text-amber-300 transition-colors cursor-pointer"
                  >
                    ⇄
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full min-h-[36px] rounded-xl border border-dashed border-sys-border px-3 py-1.5 text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/40 transition-colors cursor-pointer"
        >
          {expanded ? "Згорнути список" : `Показати ще ${hiddenCount}`}
        </button>
      )}
    </section>
  );
}

function CompareDiffColumn({
  title,
  accentClass,
  rows,
  sortBy,
  emptyLabel,
  onSelectNode,
}: {
  title: string;
  accentClass: string;
  rows: AtlasRelationRow[];
  sortBy: AtlasRelationSortKey;
  emptyLabel: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sortedRows = useMemo(() => sortAtlasRelationRows(rows, sortBy), [rows, sortBy]);
  const limit = 8;
  const visibleRows = expanded ? sortedRows : sortedRows.slice(0, limit);
  const hiddenCount = Math.max(0, sortedRows.length - limit);

  return (
    <div className="rounded-xl border border-sys-border bg-sys-bg/65 p-2.5 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[11px] font-bold uppercase tracking-wide break-words ${accentClass}`}>
          {title}
        </p>
        <span className="shrink-0 rounded-md border border-sys-border bg-sys-card px-1.5 py-0.5 text-[11px] font-semibold text-sys-text-muted tabular-nums">
          {rows.length}
        </span>
      </div>

      {sortedRows.length === 0 ? (
        <p className="text-xs text-sys-text-muted leading-relaxed">{emptyLabel}</p>
      ) : (
        <ul role="list" className="space-y-1.5">
          {visibleRows.map((row) => {
            const subjectsText = row.subjects.join(" · ");
            const roomsText = row.rooms.map((r) => `каб. ${r}`).join(", ");
            const daysText = row.days.map((d) => DAY_SHORT_NAMES[d] ?? String(d)).join(", ");
            return (
              <li key={row.node.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(row.node.id)}
                  className="w-full rounded-lg border border-sys-border bg-sys-card hover:border-sys-accent/45 px-2.5 py-2 text-left transition-colors cursor-pointer space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-semibold text-sys-text-primary break-words">
                      {row.node.label}
                    </span>
                    {row.lessonsCount > 0 && (
                      <span className="shrink-0 text-[10px] font-semibold text-sys-text-muted tabular-nums">
                        {formatPairsLabel(row.lessonsCount)}
                      </span>
                    )}
                  </div>
                  {subjectsText && (
                    <p className="text-[11px] text-sys-text-secondary leading-snug break-words">
                      {subjectsText}
                    </p>
                  )}
                  {(roomsText || daysText) && (
                    <p className="text-[10px] text-sys-text-muted break-words">
                      {roomsText}
                      {roomsText && daysText ? " · " : ""}
                      {daysText}
                    </p>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full rounded-lg border border-dashed border-sys-border py-1 text-[11px] font-medium text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer"
        >
          {expanded ? "Згорнути" : `Ще ${hiddenCount}`}
        </button>
      )}
    </div>
  );
}

function CompareSummaryCard({
  graph,
  nodeA,
  nodeB,
  intersection,
  onSwap,
  onClear,
  onSelectNode,
  onSetCompareNode,
  onAnnounceSort,
}: {
  graph: AtlasGraph;
  nodeA: AtlasGraphNode;
  nodeB: AtlasGraphNode;
  intersection: AtlasIntersectionResult;
  onSwap: () => void;
  onClear: () => void;
  onSelectNode: (nodeId: string) => void;
  onSetCompareNode: (nodeId: string | null) => void;
  onAnnounceSort: (message: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<CompareFilterTab>("all");
  const [sortBy, setSortBy] = useState<AtlasRelationSortKey>("lessons");

  useEffect(() => {
    setPickerOpen(false);
  }, [nodeA.id, nodeB.id]);

  const { sharedRows, onlyARows, onlyBRows, sharedSubjects, sharedRooms } = intersection;
  const sortedSharedRows = useMemo(
    () => sortAtlasRelationRows(sharedRows, sortBy),
    [sharedRows, sortBy],
  );
  const hasSharedMeta = sharedSubjects.length > 0 || sharedRooms.length > 0;
  const totalDiffCount = onlyARows.length + onlyBRows.length;

  const handleSortChange = (nextSort: AtlasRelationSortKey) => {
    setSortBy(nextSort);
    onAnnounceSort(
      `Порівняння відсортовано: ${SORT_LABELS[nextSort].toLowerCase()}, спільних: ${sharedRows.length}, відмінних: ${totalDiffCount}.`,
    );
  };

  return (
    <div className="[container-type:inline-size] rounded-2xl border border-amber-500/40 bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Порівняння зв&apos;язків
          </p>
          <h2 className="mt-0.5 text-base sm:text-lg font-bold text-sys-text-primary break-words [text-wrap:balance]">
            {nodeA.label} <span className="text-sys-text-muted font-normal">↔</span> {nodeB.label}
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            title="Обрати інший вузол для порівняння"
            className={`min-h-[34px] rounded-lg border px-2.5 text-xs font-semibold transition-colors cursor-pointer ${
              pickerOpen
                ? "border-sys-accent bg-sys-accent/10 text-sys-accent"
                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Змінити
          </button>
          <button
            type="button"
            onClick={onSwap}
            title="Поміняти місцями"
            aria-label="Поміняти вузли порівняння місцями"
            className="min-h-[34px] rounded-lg border border-sys-border bg-sys-bg px-2.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer"
          >
            ⇄
          </button>
          <button
            type="button"
            onClick={onClear}
            aria-label="Завершити порівняння"
            title="Повернутися до паспорта вузла"
            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {pickerOpen && (
        <CompareNodePicker
          graph={graph}
          baseNode={nodeA}
          activeCompareId={nodeB.id}
          onPickNode={(id) => {
            onSetCompareNode(id);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {/* Filter Tabs + Sort Controls */}
      <div className="space-y-2.5 pt-1 border-t border-sys-border/60">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Фільтр секцій порівняння">
          <button
            type="button"
            aria-pressed={activeTab === "all"}
            onClick={() => setActiveTab("all")}
            className={`min-h-[30px] rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "all"
                ? "border-sys-accent bg-sys-accent text-white"
                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Усе
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "shared"}
            onClick={() => setActiveTab("shared")}
            className={`min-h-[30px] rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "shared"
                ? "border-amber-500 bg-amber-500/15 text-amber-800 dark:text-amber-300"
                : "border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300"
            }`}
          >
            Спільні: {sharedRows.length}
          </button>
          <button
            type="button"
            aria-pressed={activeTab === "diff"}
            onClick={() => setActiveTab("diff")}
            className={`min-h-[30px] rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
              activeTab === "diff"
                ? "border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-300"
                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Відмінності: {onlyARows.length} / {onlyBRows.length}
          </button>
          {hasSharedMeta && (
            <button
              type="button"
              aria-pressed={activeTab === "meta"}
              onClick={() => setActiveTab("meta")}
              className={`min-h-[30px] rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                activeTab === "meta"
                  ? "border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-300"
                  : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              Предмети й каб. ({sharedSubjects.length + sharedRooms.length})
            </button>
          )}
          {intersection.directConnected && (
            <span className="inline-flex items-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              Прямий зв&apos;язок
            </span>
          )}
        </div>

        {(sharedRows.length > 1 || onlyARows.length > 1 || onlyBRows.length > 1) &&
          activeTab !== "meta" && (
            <SortControlStrip
              sortBy={sortBy}
              availableSorts={["lessons", "alpha", "room", "day"]}
              onSortChange={handleSortChange}
            />
          )}
      </div>

      {/* Shared Section */}
      {(activeTab === "all" || activeTab === "shared") && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
              Спільні зв&apos;язки ({sharedRows.length})
            </h3>
          </div>
          {sortedSharedRows.length > 0 ? (
            <ul role="list" className="space-y-1.5">
              {sortedSharedRows.map((row) => {
                const meta = KIND_META[row.node.kind];
                const subjectsText = row.subjects.join(" · ");
                const roomsText = row.rooms.map((r) => `каб. ${r}`).join(", ");
                const daysText = row.days.map((d) => DAY_SHORT_NAMES[d] ?? String(d)).join(", ");
                const showFullName =
                  Boolean(row.node.fullName) && row.node.fullName !== row.node.label;
                return (
                  <li key={row.node.id}>
                    <button
                      type="button"
                      onClick={() => onSelectNode(row.node.id)}
                      className="w-full rounded-xl border border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 px-3 py-2 text-left transition-colors cursor-pointer space-y-0.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <span className="inline-flex flex-wrap items-center gap-1.5 text-sm font-semibold text-sys-text-primary break-words">
                          <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dotClass}`} aria-hidden="true" />
                          <span>{row.node.label}</span>
                          {showFullName && (
                            <span className="text-xs font-normal text-sys-text-muted">
                              ({row.node.fullName})
                            </span>
                          )}
                        </span>
                        {row.lessonsCount > 0 && (
                          <span className="text-[11px] font-semibold text-sys-text-secondary tabular-nums">
                            {formatPairsLabel(row.lessonsCount)}
                          </span>
                        )}
                      </div>
                      {(subjectsText || roomsText || daysText) && (
                        <p className="text-xs text-sys-text-secondary break-words">
                          {subjectsText}
                          {subjectsText && (roomsText || daysText) ? " · " : ""}
                          {roomsText}
                          {roomsText && daysText ? " · " : ""}
                          {daysText}
                        </p>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-sys-text-muted leading-relaxed">
              У активному розкладі спільних викладачів чи груп не знайдено.
            </p>
          )}
        </section>
      )}

      {/* Shared Subjects & Rooms Summary (now always accessible even when sharedRows > 0) */}
      {hasSharedMeta && (activeTab === "all" || activeTab === "meta" || activeTab === "shared") && (
        <section className="rounded-xl border border-sys-border bg-sys-bg/65 p-3 space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-sys-text-secondary">
            Спільні дисципліни та кабінети
          </h3>
          {sharedSubjects.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-sys-text-primary">
                Предмети ({sharedSubjects.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {sharedSubjects.map((s) => (
                  <span
                    key={s.id}
                    className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300"
                  >
                    <span>{s.label}</span>
                    <span className="opacity-75 tabular-nums">· {s.lessonsCount}п</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {sharedRooms.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-sys-text-primary">
                Кабінети ({sharedRooms.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {sharedRooms.map((r) => (
                  <span
                    key={r.name}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300"
                  >
                    <span>каб. {r.name}</span>
                    <span className="opacity-75 tabular-nums">· {r.lessonsCount}п</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* Differences Section: Clear side-by-side comparison */}
      {(activeTab === "all" || activeTab === "diff") && (
        <section className="space-y-2 pt-2 border-t border-sys-border/70">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
            Що відрізняється ({onlyARows.length} vs {onlyBRows.length})
          </h3>
          <div className="grid grid-cols-1 @[420px]:grid-cols-2 gap-2.5">
            <CompareDiffColumn
              title={`Тільки у ${nodeA.label}`}
              accentClass="text-blue-700 dark:text-blue-300"
              rows={onlyARows}
              sortBy={sortBy}
              emptyLabel="Усі зв'язки є спільними"
              onSelectNode={onSelectNode}
            />
            <CompareDiffColumn
              title={`Тільки у ${nodeB.label}`}
              accentClass="text-rose-700 dark:text-rose-300"
              rows={onlyBRows}
              sortBy={sortBy}
              emptyLabel="Усі зв'язки є спільними"
              onSelectNode={onSelectNode}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function AtlasDirectoryBrowserCard({
  graph,
  courseFilter,
  onSelectNode,
  onAnnounceSort,
}: {
  graph: AtlasGraph;
  courseFilter: number | null;
  onSelectNode: (nodeId: string) => void;
  onAnnounceSort: (message: string) => void;
}) {
  const [activeKind, setActiveKind] = useState<"group" | "teacher">("group");
  const [sortBy, setSortBy] = useState<"course" | "alpha" | "lessons">("course");
  const [filterQuery, setFilterQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const filterInputId = useId();

  useEffect(() => {
    if (courseFilter !== null) {
      setActiveKind("group");
    }
    setExpanded(false);
  }, [courseFilter]);

  const items = useMemo(() => {
    const needle = filterQuery.trim().toLowerCase();
    const filtered = graph.nodes.filter((n) => {
      if (!n.isConnected || n.kind !== activeKind) return false;
      if (activeKind === "group" && courseFilter !== null && n.course !== courseFilter) {
        return false;
      }
      if (!needle) return true;
      return (
        n.label.toLowerCase().includes(needle) ||
        (n.fullName && n.fullName.toLowerCase().includes(needle)) ||
        (n.subtitle && n.subtitle.toLowerCase().includes(needle)) ||
        (n.facultyName && n.facultyName.toLowerCase().includes(needle))
      );
    });

    filtered.sort((a, b) => {
      if (sortBy === "lessons") {
        if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
        if (b.degree !== a.degree) return b.degree - a.degree;
        return compareAtlasLabels(a.label, b.label);
      }
      if (sortBy === "alpha") {
        return compareAtlasLabels(a.label, b.label);
      }
      // "course" default
      if (a.kind === "group" && b.kind === "group") {
        const ca = a.course ?? 99;
        const cb = b.course ?? 99;
        if (ca !== cb) return ca - cb;
      }
      return compareAtlasLabels(a.label, b.label);
    });

    return filtered;
  }, [graph.nodes, activeKind, courseFilter, filterQuery, sortBy]);

  const limit = 24;
  const visibleItems = expanded ? items : items.slice(0, limit);
  const hiddenCount = Math.max(0, items.length - limit);

  const handleSortClick = (next: "course" | "alpha" | "lessons") => {
    setSortBy(next);
    const label =
      next === "lessons" ? "за парами" : next === "alpha" ? "за алфавітом" : "за курсом і кодом";
    onAnnounceSort(`Каталог відсортовано ${label}, ${items.length} елементів.`);
  };

  return (
    <aside
      aria-label="Каталог вузлів Атласу"
      className="[container-type:inline-size] rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-sys-text-primary [text-wrap:balance]">
            {courseFilter !== null && activeKind === "group"
              ? `Групи ${courseFilter} курсу`
              : "Каталог коледжу"}
          </h2>
          <p className="text-xs text-sys-text-secondary">
            Оберіть групу чи викладача на мапі або зі списку нижче
          </p>
        </div>
        <span className="shrink-0 rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-secondary tabular-nums">
          {items.length}
        </span>
      </div>

      {/* Category Switcher (Groups vs Teachers) */}
      <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-sys-border bg-sys-bg p-1">
        <button
          type="button"
          aria-pressed={activeKind === "group"}
          onClick={() => {
            setActiveKind("group");
            setSortBy("course");
          }}
          className={`min-h-[34px] inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            activeKind === "group"
              ? "bg-sys-accent text-white shadow-xs"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <UsersIcon className="w-3.5 h-3.5" />
          <span>Групи</span>
        </button>
        <button
          type="button"
          aria-pressed={activeKind === "teacher"}
          onClick={() => {
            setActiveKind("teacher");
            if (sortBy === "course") setSortBy("alpha");
          }}
          className={`min-h-[34px] inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
            activeKind === "teacher"
              ? "bg-sys-accent text-white shadow-xs"
              : "text-sys-text-secondary hover:text-sys-text-primary"
          }`}
        >
          <GraduationCapIcon className="w-3.5 h-3.5" />
          <span>Викладачі</span>
        </button>
      </div>

      {/* Inline Filter + Sort */}
      <div className="space-y-2">
        <label htmlFor={filterInputId} className="sr-only">
          Фільтр каталогу
        </label>
        <div className="relative flex items-center">
          <SearchIcon className="w-3.5 h-3.5 text-sys-text-muted pointer-events-none absolute left-3" />
          <input
            id={filterInputId}
            type="search"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={
              activeKind === "group"
                ? "Фільтр за кодом групи або відділенням..."
                : "Фільтр за прізвищем або кабінетом..."
            }
            className="w-full min-h-[36px] rounded-xl border border-sys-border bg-sys-bg pl-8 pr-8 py-1.5 text-xs sm:text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              aria-label="Очистити фільтр каталогу"
              className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-text-primary cursor-pointer"
            >
              <CloseIcon className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Сортування каталогу">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sys-text-muted mr-0.5">
            <SlidersIcon className="w-3 h-3" />
            <span>Сортувати:</span>
          </span>
          {activeKind === "group" && (
            <button
              type="button"
              aria-pressed={sortBy === "course"}
              onClick={() => handleSortClick("course")}
              className={`min-h-[28px] rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
                sortBy === "course"
                  ? "border-sys-accent/50 bg-sys-accent/12 text-sys-accent"
                  : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
              }`}
            >
              За курсом
            </button>
          )}
          <button
            type="button"
            aria-pressed={sortBy === "alpha"}
            onClick={() => handleSortClick("alpha")}
            className={`min-h-[28px] rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              sortBy === "alpha"
                ? "border-sys-accent/50 bg-sys-accent/12 text-sys-accent"
                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            А–Я
          </button>
          <button
            type="button"
            aria-pressed={sortBy === "lessons"}
            onClick={() => handleSortClick("lessons")}
            className={`min-h-[28px] rounded-lg border px-2 py-0.5 text-[11px] font-semibold transition-colors cursor-pointer ${
              sortBy === "lessons"
                ? "border-sys-accent/50 bg-sys-accent/12 text-sys-accent"
                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            За парами
          </button>
        </div>
      </div>

      {activeKind === "group" ? (
        <div className="grid grid-cols-2 @[380px]:grid-cols-3 gap-1.5">
          {visibleItems.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelectNode(g.id)}
              className="min-h-[42px] rounded-xl border border-sys-border bg-sys-bg/70 hover:border-sys-accent/60 hover:bg-sys-accent/10 px-2.5 py-2 text-left transition-colors cursor-pointer flex flex-col justify-between gap-0.5"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-bold text-sys-text-primary truncate">
                  {g.label}
                </span>
                {g.course && courseFilter === null && (
                  <span className="text-[10px] font-semibold text-blue-700 dark:text-blue-300 shrink-0">
                    {g.course}к
                  </span>
                )}
              </div>
              <span className="text-[11px] font-medium text-sys-text-muted tabular-nums">
                {formatPairsLabel(g.lessonsCount)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <ul role="list" className="space-y-1.5">
          {visibleItems.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => onSelectNode(t.id)}
                className="w-full min-h-[42px] rounded-xl border border-sys-border bg-sys-bg/70 hover:border-sys-accent/60 hover:bg-sys-accent/10 px-3 py-2 text-left transition-colors cursor-pointer flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-sys-text-primary truncate">
                    {t.label}
                  </p>
                  {(t.homeRoom || t.fullName) && (
                    <p className="text-[11px] text-sys-text-muted truncate">
                      {t.homeRoom ? `каб. ${t.homeRoom}` : ""}
                      {t.homeRoom && t.fullName ? " · " : ""}
                      {t.fullName ?? ""}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded-lg border border-sys-border bg-sys-card px-2 py-0.5 text-[11px] font-semibold text-sys-text-secondary tabular-nums">
                  {formatPairsLabel(t.lessonsCount)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="w-full min-h-[36px] rounded-xl border border-dashed border-sys-border px-3 py-1.5 text-xs font-medium text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer"
        >
          {expanded ? "Згорнути каталог" : `Показати ще ${hiddenCount}`}
        </button>
      )}
    </aside>
  );
}

function AtlasInspectorPanel({
  graph,
  inspector,
  compareNodeId,
  intersection,
  courseFilter,
  onSelectNode,
  onSetCompareNode,
  onSwapCompare,
  onPickSearchTerm,
  onAnnounceSort,
}: {
  graph: AtlasGraph;
  inspector: AtlasNodeInspectorData | null;
  compareNodeId: string | null;
  intersection: AtlasIntersectionResult | null;
  courseFilter: number | null;
  onSelectNode: (nodeId: string) => void;
  onSetCompareNode: (nodeId: string | null) => void;
  onSwapCompare: () => void;
  onPickSearchTerm: (term: string) => void;
  onAnnounceSort: (message: string) => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<InspectorTabKey>("primary");
  const [sortBy, setSortBy] = useState<AtlasRelationSortKey>("lessons");
  const [listFilterQuery, setListFilterQuery] = useState("");
  const listFilterInputId = useId();

  useEffect(() => {
    setCompareOpen(false);
    setActiveTab("primary");
    setListFilterQuery("");
    if (inspector?.node.kind === "teacher") {
      setSortBy("course");
    } else {
      setSortBy("lessons");
    }
  }, [inspector?.node.id, inspector?.node.kind]);

  const compareNode = compareNodeId ? (graph.nodeMap.get(compareNodeId) ?? null) : null;

  if (!inspector) {
    return (
      <AtlasDirectoryBrowserCard
        graph={graph}
        courseFilter={courseFilter}
        onSelectNode={onSelectNode}
        onAnnounceSort={onAnnounceSort}
      />
    );
  }

  const { node, curatorTeacher, curatedGroups, groups, teachers, subjects, rooms } = inspector;
  const meta = KIND_META[node.kind];
  const scheduleHref = getScheduleHref(node);
  const neighborsCount = graph.adjacency.get(node.id)?.size ?? 0;

  if (intersection && compareNode) {
    return (
      <aside
        aria-label={`Порівняння ${node.label} та ${compareNode.label}`}
        className="space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto pr-0.5"
      >
        <CompareSummaryCard
          graph={graph}
          nodeA={node}
          nodeB={compareNode}
          intersection={intersection}
          onSwap={onSwapCompare}
          onClear={() => onSetCompareNode(null)}
          onSelectNode={onSelectNode}
          onSetCompareNode={onSetCompareNode}
          onAnnounceSort={onAnnounceSort}
        />
      </aside>
    );
  }

  const primaryRows = node.kind === "group" ? teachers : groups;
  const primaryKind: AtlasNodeKind = node.kind === "group" ? "teacher" : "group";
  const primaryTabLabel = node.kind === "group" ? "Викладачі" : "Групи";

  const activeRows =
    activeTab === "primary"
      ? primaryRows
      : activeTab === "subjects"
        ? subjects
        : rooms;
  const activeKind: AtlasNodeKind =
    activeTab === "primary"
      ? primaryKind
      : activeTab === "subjects"
        ? "subject"
        : "room";
  const activeSectionTitle =
    activeTab === "primary"
      ? node.kind === "group"
        ? "Викладачі, предмети та кабінети"
        : "Групи, предмети та кабінети"
      : activeTab === "subjects"
        ? "Дисципліни у розкладі"
        : "Аудиторії та кабінети";

  const availableSorts: AtlasRelationSortKey[] =
    activeTab === "primary" && primaryKind === "group"
      ? ["course", "lessons", "alpha", "room", "day"]
      : activeTab === "subjects"
        ? ["lessons", "alpha", "day"]
        : activeTab === "rooms"
          ? ["lessons", "alpha", "day"]
          : ["lessons", "alpha", "room", "day"];

  const effectiveSortBy: AtlasRelationSortKey = availableSorts.includes(sortBy)
    ? sortBy
    : availableSorts[0];

  const handleSortChange = (nextSort: AtlasRelationSortKey) => {
    setSortBy(nextSort);
    onAnnounceSort(
      `Список відсортовано: ${SORT_LABELS[nextSort].toLowerCase()}, ${activeRows.length} елементів.`,
    );
  };

  return (
    <aside
      aria-label={`Паспорт вузла ${node.label}`}
      className="[container-type:inline-size] space-y-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-5.5rem)] lg:overflow-y-auto pr-0.5"
    >
      <div className="rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
        {/* Identity Header */}
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${meta.pillClass}`}
            >
              <KindIcon kind={node.kind} className="w-3.5 h-3.5" />
              <span>{meta.singular}</span>
            </span>

            <div className="flex items-center gap-1.5 text-xs font-semibold text-sys-text-secondary tabular-nums">
              <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-1">
                {neighborsCount} зв&apos;язків
              </span>
              {node.lessonsCount > 0 && (
                <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-1">
                  {formatPairsLabel(node.lessonsCount)} / тиж.
                </span>
              )}
            </div>
          </div>

          <h2 className="text-lg sm:text-xl font-bold text-sys-text-primary leading-snug break-words [text-wrap:balance]">
            {node.label}
          </h2>

          {node.fullName && node.fullName !== node.label && (
            <p className="text-xs font-medium text-sys-text-secondary">
              Повне ім&apos;я: <span className="text-sys-text-primary font-semibold">{node.fullName}</span>
            </p>
          )}

          {/* Contextual chips (Course, Faculty, Curator, Home Room) */}
          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            {node.course && (
              <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-xs font-medium text-sys-text-secondary">
                {node.course} курс
              </span>
            )}
            {node.facultyName && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-xs font-medium text-sys-text-secondary">
                <BuildingIcon className="w-3 h-3 text-sys-text-muted" />
                <span>{node.facultyName}</span>
              </span>
            )}
            {curatorTeacher && (
              <button
                type="button"
                onClick={() => onSelectNode(curatorTeacher.id)}
                title="Перейти до куратора групи"
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
              >
                <span>Куратор: {curatorTeacher.label}</span>
              </button>
            )}
            {curatedGroups.map((cg) => (
              <button
                key={cg.id}
                type="button"
                onClick={() => onSelectNode(cg.id)}
                title={`Перейти до кураторської групи ${cg.label}`}
                className="inline-flex items-center gap-1 rounded-lg border border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 transition-colors cursor-pointer"
              >
                <span>Куратор групи {cg.label}</span>
              </button>
            ))}
            {node.homeRoom && (
              <span className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
                Кабінет {node.homeRoom}
              </span>
            )}
          </div>
        </div>

        {/* Action Toolbar */}
        <div className="flex flex-wrap gap-2">
          {scheduleHref && (
            <Link
              href={scheduleHref}
              className="min-h-[38px] inline-flex items-center gap-1.5 rounded-xl bg-sys-accent px-3.5 py-2 text-xs font-semibold text-white hover:brightness-110 transition-colors"
            >
              <CalendarIcon className="w-3.5 h-3.5" />
              <span>Відкрити розклад</span>
            </Link>
          )}

          <button
            type="button"
            aria-expanded={compareOpen}
            onClick={() => setCompareOpen((prev) => !prev)}
            className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              compareOpen
                ? "border-amber-500/45 bg-amber-500/12 text-amber-800 dark:text-amber-300"
                : "border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/45"
            }`}
          >
            <BarChartIcon className="w-3.5 h-3.5" />
            <span>Порівняти перетин</span>
          </button>
        </div>

        {/* Smart Inline Compare Picker */}
        {compareOpen && (
          <CompareNodePicker
            graph={graph}
            baseNode={node}
            activeCompareId={compareNodeId}
            onPickNode={(id) => {
              onSetCompareNode(id);
              setCompareOpen(false);
            }}
            onClose={() => setCompareOpen(false)}
          />
        )}

        {/* Unified Relations & Subjects/Rooms List with Category Tabs & Sorting */}
        <div className="pt-2 border-t border-sys-border/70 space-y-3">
          {node.lessonsCount === 0 && neighborsCount === 0 ? (
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              Наразі цей елемент є в довіднику, але не має активних пар у поточному тижневому
              розкладі.
            </p>
          ) : (
            <>
              {/* Category Tabs: Викладачі/Групи | Предмети | Кабінети */}
              <div
                role="tablist"
                aria-label="Категорії зв'язків вузла"
                className="grid grid-cols-3 gap-1 rounded-xl border border-sys-border bg-sys-bg p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "primary"}
                  onClick={() => setActiveTab("primary")}
                  className={`min-h-[32px] rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                    activeTab === "primary"
                      ? "bg-sys-card text-sys-text-primary shadow-xs border border-sys-border/70"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  <span className="truncate">{primaryTabLabel}</span>
                  <span className="text-[10px] text-sys-text-muted tabular-nums">
                    {primaryRows.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "subjects"}
                  onClick={() => setActiveTab("subjects")}
                  className={`min-h-[32px] rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                    activeTab === "subjects"
                      ? "bg-sys-card text-sys-text-primary shadow-xs border border-sys-border/70"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  <span className="truncate">Предмети</span>
                  <span className="text-[10px] text-sys-text-muted tabular-nums">
                    {subjects.length}
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "rooms"}
                  onClick={() => setActiveTab("rooms")}
                  className={`min-h-[32px] rounded-lg px-2 py-1 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1 ${
                    activeTab === "rooms"
                      ? "bg-sys-card text-sys-text-primary shadow-xs border border-sys-border/70"
                      : "text-sys-text-secondary hover:text-sys-text-primary"
                  }`}
                >
                  <span className="truncate">Кабінети</span>
                  <span className="text-[10px] text-sys-text-muted tabular-nums">
                    {rooms.length}
                  </span>
                </button>
              </div>

              {/* Sort Controls + Inline Filter */}
              {activeRows.length > 1 && (
                <div className="space-y-2">
                  <SortControlStrip
                    sortBy={effectiveSortBy}
                    availableSorts={availableSorts}
                    onSortChange={handleSortChange}
                  />

                  {activeRows.length >= 5 && (
                    <div className="relative flex items-center">
                      <label htmlFor={listFilterInputId} className="sr-only">
                        Фільтр у списку зв&apos;язків
                      </label>
                      <SearchIcon className="w-3.5 h-3.5 text-sys-text-muted pointer-events-none absolute left-2.5" />
                      <input
                        id={listFilterInputId}
                        type="search"
                        value={listFilterQuery}
                        onChange={(e) => setListFilterQuery(e.target.value)}
                        placeholder="Швидкий фільтр (назва, предмет, каб., Пн–Пт)..."
                        className="w-full min-h-[34px] rounded-xl border border-sys-border bg-sys-bg pl-8 pr-8 py-1 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
                      />
                      {listFilterQuery && (
                        <button
                          type="button"
                          onClick={() => setListFilterQuery("")}
                          aria-label="Очистити фільтр списку"
                          className="absolute right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md text-sys-text-muted hover:text-sys-text-primary cursor-pointer"
                        >
                          <CloseIcon className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <RelationListSection
                title={activeSectionTitle}
                kind={activeKind}
                rows={activeRows}
                sortBy={effectiveSortBy}
                filterQuery={listFilterQuery}
                onSelectNode={onSelectNode}
                onQuickCompareNode={
                  activeTab === "primary" ? (targetId) => onSetCompareNode(targetId) : undefined
                }
                onPickSearchTerm={onPickSearchTerm}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

export function AtlasClient() {
  const { resolvedTheme } = useTheme();
  const shouldReduceMotion = Boolean(useReducedMotion());

  const [data, setData] = useState<AtlasResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [homeNodeId, setHomeNodeId] = useState<string | null>(null);
  const [compareNodeId, setCompareNodeId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<"constellation" | "ego">("ego");
  const [courseFilter, setCourseFilter] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<MobileWorkspaceView>("split");
  const [sortStatusAnnouncement, setSortStatusAnnouncement] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIdx, setActiveSearchIdx] = useState(0);

  const initialFocusedRef = useRef(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputId = useId();
  const searchListboxId = useId();

  const loadAtlas = useCallback(async (isManualRefresh = false) => {
    const cached = !isManualRefresh ? readCacheSnapshot<AtlasResponse>(ATLAS_CACHE_KEY) : null;
    if (cached) {
      setData(cached.data);
      setLoading(false);
      setRefreshing(true);
    } else if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const fresh = await api.directory.atlas();
      setData(fresh);
      writeCacheSnapshot(ATLAS_CACHE_KEY, fresh);
      setError(null);
    } catch (err) {
      if (!cached) {
        setError(
          err instanceof Error
            ? err.message
            : "Не вдалося завантажити дані Атласу. Спробуйте оновити сторінку.",
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadAtlas(false);
  }, [loadAtlas]);

  const graph = useMemo(() => (data ? buildAtlasGraph(data) : null), [data]);

  // Auto-focus saved group/teacher from localStorage or URL query param once graph loads
  useEffect(() => {
    if (!graph || initialFocusedRef.current) return;
    initialFocusedRef.current = true;

    if (typeof window !== "undefined") {
      let savedHomeId: string | null = null;
      try {
        const storedMode = window.localStorage.getItem("schedule:mode");
        const storedGroupId = Number(window.localStorage.getItem("schedule:groupId")) || null;
        const storedTeacherId = Number(window.localStorage.getItem("schedule:teacherId")) || null;

        if (storedMode === "teacher" && storedTeacherId) {
          const tid = makeAtlasNodeId("teacher", storedTeacherId);
          if (graph.nodeMap.has(tid)) savedHomeId = tid;
        }
        if (!savedHomeId && storedGroupId) {
          const gid = makeAtlasNodeId("group", storedGroupId);
          if (graph.nodeMap.has(gid)) savedHomeId = gid;
        }
      } catch {
        // Ignore storage errors in restricted environments
      }
      setHomeNodeId(savedHomeId);

      const params = new URLSearchParams(window.location.search);
      const qNode = params.get("node");
      const qCompare = params.get("compare");
      if (qNode && graph.nodeMap.has(qNode)) {
        setSelectedNodeId(qNode);
        if (qCompare && qCompare !== qNode && graph.nodeMap.has(qCompare)) {
          setCompareNodeId(qCompare);
        }
        return;
      }

      if (savedHomeId) {
        setSelectedNodeId(savedHomeId);
        return;
      }
    }

    const fallbackNode =
      graph.nodes
        .filter((n) => n.kind === "group" && n.isConnected)
        .sort((a, b) => b.lessonsCount - a.lessonsCount)[0] ??
      graph.nodes.find((n) => n.isConnected) ??
      graph.nodes[0];

    if (fallbackNode) {
      setSelectedNodeId(fallbackNode.id);
    }
  }, [graph]);

  // Close search dropdown on outside pointer down
  useEffect(() => {
    const onOutside = (e: PointerEvent) => {
      if (!searchBoxRef.current) return;
      if (!searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, []);

  const availableCourses = useMemo(() => {
    if (!data) return [];
    const set = new Set<number>();
    for (const g of data.groups) {
      if (typeof g.course === "number" && g.course > 0) set.add(g.course);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [data]);

  const searchResults = useMemo(() => {
    if (!graph) return [];
    if (!searchQuery.trim()) {
      return searchAtlasNodes(graph, "", {
        limit: 36,
        onlyConnected: true,
        preferredCourse: courseFilter,
      });
    }
    return searchAtlasNodes(graph, searchQuery, { limit: 24 });
  }, [graph, searchQuery, courseFilter]);

  useEffect(() => {
    setActiveSearchIdx(0);
  }, [searchResults.length, searchQuery]);

  const homeNode = useMemo(
    () => (graph && homeNodeId ? (graph.nodeMap.get(homeNodeId) ?? null) : null),
    [graph, homeNodeId],
  );

  const showReturnHomeButton = Boolean(
    homeNode &&
      (selectedNodeId !== homeNode.id ||
        compareNodeId !== null ||
        courseFilter !== null ||
        layoutMode !== "ego"),
  );

  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      if (nodeId) {
        setLayoutMode("ego");
        if (courseFilter !== null) {
          setCourseFilter(null);
        }
      }
      if (nodeId && compareNodeId === nodeId) {
        setCompareNodeId(null);
      }
    },
    [compareNodeId, courseFilter],
  );

  const handleReturnToHomeNode = useCallback(() => {
    if (!homeNode) return;
    setCompareNodeId(null);
    setCourseFilter(null);
    setSelectedNodeId(homeNode.id);
    setLayoutMode("ego");
  }, [homeNode]);

  const handleCourseFilterSelect = useCallback(
    (course: number | null) => {
      const next = courseFilter === course ? null : course;
      setCourseFilter(next);
      setCompareNodeId(null);
      setSelectedNodeId(null);
      setLayoutMode("constellation");
    },
    [courseFilter],
  );

  const handleSetCompareNode = useCallback(
    (nextCompareId: string | null) => {
      if (!nextCompareId || nextCompareId === selectedNodeId) {
        setCompareNodeId(null);
        return;
      }
      setCompareNodeId(nextCompareId);
      setCourseFilter(null);
    },
    [selectedNodeId],
  );

  const handleSwapCompare = useCallback(() => {
    if (!selectedNodeId || !compareNodeId) return;
    const prevA = selectedNodeId;
    const prevB = compareNodeId;
    setSelectedNodeId(prevB);
    setCompareNodeId(prevA);
  }, [selectedNodeId, compareNodeId]);

  const handlePickSearchTerm = useCallback((term: string) => {
    setSearchQuery(term);
    setSearchOpen(true);
    searchInputRef.current?.focus();
  }, []);

  const inspector = useMemo(() => {
    if (!graph || !selectedNodeId) return null;
    return getNodeInspectorData(graph, selectedNodeId);
  }, [graph, selectedNodeId]);

  const intersection = useMemo(() => {
    if (!graph || !selectedNodeId || !compareNodeId || selectedNodeId === compareNodeId) {
      return null;
    }
    return computeNodeIntersection(graph, selectedNodeId, compareNodeId);
  }, [graph, selectedNodeId, compareNodeId]);

  const handlePickSearchCandidate = (candidate: AtlasSearchCandidate) => {
    handleSelectNode(candidate.node.id);
    setSearchQuery("");
    setSearchOpen(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Escape") {
      setSearchOpen(false);
      return;
    }
    if (!searchResults.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSearchOpen(true);
      setActiveSearchIdx((prev) => (prev + 1) % searchResults.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSearchOpen(true);
      setActiveSearchIdx((prev) => (prev - 1 + searchResults.length) % searchResults.length);
    } else if (e.key === "Enter" && searchOpen) {
      e.preventDefault();
      const target = searchResults[activeSearchIdx] ?? searchResults[0];
      if (target) handlePickSearchCandidate(target);
    }
  };

  const liveAnnouncement = useMemo(() => {
    if (!graph || !selectedNodeId) return "";
    const node = graph.nodeMap.get(selectedNodeId);
    if (!node) return "";
    const deg = graph.adjacency.get(node.id)?.size ?? 0;
    if (intersection) {
      const b = graph.nodeMap.get(intersection.nodeBId);
      const totalShared =
        intersection.sharedNodeIds.size +
        intersection.sharedSubjects.length +
        intersection.sharedRooms.length;
      return `Порівняння: ${node.label} та ${b?.label ?? ""}. Спільного: ${totalShared}.`;
    }
    return `Обрано ${KIND_META[node.kind].singular.toLowerCase()} ${node.label}. Зв'язків: ${deg}.`;
  }, [graph, selectedNodeId, intersection]);

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary flex flex-col">
      <SubpageHeader
        title="Атлас ДФКР"
        subtitle="Орбіти груп і викладачів коледжу"
        maxWidthClass="max-w-[1600px]"
        rightSlot={
          <button
            type="button"
            onClick={() => void loadAtlas(true)}
            disabled={loading || refreshing}
            aria-label="Оновити дані мапи"
            title="Оновити дані мапи"
            className="min-h-[36px] inline-flex items-center gap-1.5 rounded-xl border border-sys-border bg-sys-card px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary hover:border-sys-accent/50 transition-colors cursor-pointer disabled:opacity-55"
          >
            <svg
              aria-hidden="true"
              className={`w-3.5 h-3.5 shrink-0 ${refreshing ? "animate-spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 16h5v5" />
            </svg>
            <span className="hidden sm:inline">Оновити</span>
          </button>
        }
      />

      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-6 pt-3 sm:pt-4 pb-24 sm:pb-12 space-y-3 sm:space-y-4 focus:outline-none"
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>
        <p role="status" className="sr-only">
          {sortStatusAnnouncement}
        </p>

        {/* Loading Skeleton */}
        {loading && !data && (
          <div className="space-y-4" aria-busy="true">
            <div className="h-14 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-7 xl:col-span-8 h-[340px] sm:h-[460px] lg:h-[660px] rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
              <div className="lg:col-span-5 xl:col-span-4 h-[460px] rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
            </div>
          </div>
        )}

        {/* Error State */}
        {error && !data && (
          <div className="rounded-2xl border border-rose-500/35 bg-sys-card p-6 text-center space-y-3">
            <p className="text-base font-bold text-sys-text-primary">Не вдалося завантажити Атлас</p>
            <p className="text-sm text-sys-text-secondary max-w-md mx-auto">{error}</p>
            <button
              type="button"
              onClick={() => void loadAtlas(true)}
              className="min-h-[40px] inline-flex items-center justify-center rounded-xl bg-sys-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 transition-colors cursor-pointer"
            >
              Спробувати знову
            </button>
          </div>
        )}

        {data && graph && (
          <>
            {/* Compact Toolbar: Search + Return Home + Course Filter Pills + Mobile View Switcher */}
            <section
              aria-label="Пошук, фільтр курсів та режим відображення"
              className="relative z-20 rounded-2xl border border-sys-border bg-sys-card p-2.5 sm:p-3 shadow-xs space-y-2.5 lg:space-y-0 lg:flex lg:items-center lg:gap-2.5"
            >
              {/* Search Combobox */}
              <div ref={searchBoxRef} className="relative flex-1 min-w-0">
                <label htmlFor={searchInputId} className="sr-only">
                  Пошук групи, викладача, предмета або кабінету
                </label>
                <div className="relative flex items-center">
                  <SearchIcon className="w-4 h-4 text-sys-text-muted pointer-events-none absolute left-3" />
                  <input
                    ref={searchInputRef}
                    id={searchInputId}
                    type="search"
                    role="combobox"
                    aria-expanded={searchOpen}
                    aria-controls={searchListboxId}
                    aria-autocomplete="list"
                    value={searchQuery}
                    onFocus={() => setSearchOpen(true)}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setSearchOpen(true);
                    }}
                    onKeyDown={handleSearchKeyDown}
                    placeholder="Знайти групу, викладача, предмет або кабінет..."
                    className="w-full min-h-[40px] rounded-xl border border-sys-border bg-sys-bg pl-9 pr-9 py-2 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchOpen(false);
                      }}
                      aria-label="Очистити пошук"
                      className="absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-lg text-sys-text-muted hover:text-sys-text-primary cursor-pointer"
                    >
                      <CloseIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {searchOpen && (
                  <div
                    id={searchListboxId}
                    role="listbox"
                    aria-label="Результати пошуку"
                    className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-80 overflow-y-auto rounded-2xl border border-sys-elevated-border bg-sys-card/95 backdrop-blur-xl p-1.5 shadow-xl"
                  >
                    {searchResults.length === 0 ? (
                      <p className="px-3 py-4 text-center text-xs text-sys-text-muted">
                        Нічого не знайдено за запитом «{searchQuery}»
                      </p>
                    ) : (
                      searchResults.map((candidate, index) => {
                        const { node, matchHint } = candidate;
                        const meta = KIND_META[node.kind];
                        const isHighlighted = index === activeSearchIdx;
                        const subtitleLine = [matchHint, node.subtitle].filter(Boolean).join(" · ");
                        const prevCandidate = index > 0 ? searchResults[index - 1] : null;
                        const showGroupHeading =
                          !searchQuery.trim() && index === 0 && node.kind === "group";
                        const showTeacherHeading =
                          !searchQuery.trim() &&
                          node.kind === "teacher" &&
                          (index === 0 || prevCandidate?.node.kind !== "teacher");
                        return (
                          <React.Fragment key={node.id}>
                            {showGroupHeading && (
                              <p className="px-3 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sys-text-muted">
                                Групи
                              </p>
                            )}
                            {showTeacherHeading && (
                              <p className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-sys-text-muted">
                                Викладачі
                              </p>
                            )}
                            <button
                              type="button"
                              role="option"
                              aria-selected={isHighlighted}
                              onClick={() => handlePickSearchCandidate(candidate)}
                              className={`w-full min-h-[40px] rounded-xl px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isHighlighted ? "bg-sys-accent/12" : "hover:bg-sys-bg"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-sys-text-primary break-words">
                                  {node.label}
                                  {node.fullName && node.fullName !== node.label && (
                                    <span className="ml-1.5 text-xs font-normal text-sys-text-muted">
                                      ({node.fullName})
                                    </span>
                                  )}
                                </p>
                                {subtitleLine && (
                                  <p className="text-[11px] text-sys-text-secondary break-words">
                                    {subtitleLine}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${meta.pillClass}`}
                              >
                                {meta.singular}
                              </span>
                            </button>
                          </React.Fragment>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {/* Quick Return + Course Filter Pills (horizontally scrollable on narrow screens) */}
              <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar pb-0.5 lg:pb-0 shrink-0">
                <div className="flex items-center gap-1.5 shrink-0">
                  {showReturnHomeButton && homeNode && (
                    <button
                      type="button"
                      onClick={handleReturnToHomeNode}
                      title={`Повернутися до орбіти: ${homeNode.fullName || homeNode.label}`}
                      className="min-h-[34px] inline-flex items-center gap-1.5 rounded-xl border border-sys-accent/40 bg-sys-accent/10 px-2.5 py-1 text-xs font-semibold text-sys-accent hover:bg-sys-accent/20 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <span aria-hidden="true">↺</span>
                      <span>
                        {homeNode.kind === "group"
                          ? `Моя група: ${homeNode.label}`
                          : `Мій розклад: ${homeNode.label}`}
                      </span>
                    </button>
                  )}
                  {availableCourses.length > 0 && (
                    <>
                      <button
                        type="button"
                        aria-pressed={courseFilter === null && layoutMode === "constellation"}
                        onClick={() => handleCourseFilterSelect(null)}
                        className={`min-h-[34px] rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                          courseFilter === null && layoutMode === "constellation"
                            ? "border-sys-accent/45 bg-sys-accent/10 text-sys-accent"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        Усі курси
                      </button>
                      {availableCourses.map((course) => {
                        const active = courseFilter === course;
                        return (
                          <button
                            key={course}
                            type="button"
                            aria-pressed={active}
                            onClick={() => handleCourseFilterSelect(course)}
                            className={`min-h-[34px] rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                              active
                                ? "border-sys-accent bg-sys-accent text-white"
                                : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                            }`}
                          >
                            {course} курс
                          </button>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>

              {/* Mobile & Tablet Workspace Switcher (< 1024px) */}
              <div
                role="group"
                aria-label="Режим відображення на мобільних та середніх екранах"
                className="flex lg:hidden items-center justify-between gap-1 rounded-xl border border-sys-border bg-sys-bg p-1"
              >
                {(
                  [
                    { key: "split", label: "Мапа + Список" },
                    { key: "map", label: "Велика мапа" },
                    { key: "list", label: "Тільки список" },
                  ] as Array<{ key: MobileWorkspaceView; label: string }>
                ).map((mode) => {
                  const active = mobileView === mode.key;
                  return (
                    <button
                      key={mode.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMobileView(mode.key)}
                      className={`flex-1 min-h-[32px] rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? "bg-sys-card text-sys-text-primary shadow-xs border border-sys-border/70"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </section>

            {/* Primary Workspace Grid: Side-by-side starting from lg (1024px+) */}
            <div className="relative z-10 grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              {/* Map Column */}
              <div
                className={`lg:col-span-7 xl:col-span-8 min-w-0 ${
                  mobileView === "list" ? "hidden lg:block" : "block"
                }`}
              >
                <AtlasCanvas
                  graph={graph}
                  layoutMode={layoutMode}
                  selectedNodeId={selectedNodeId}
                  compareNodeId={compareNodeId}
                  intersection={intersection}
                  courseFilter={courseFilter}
                  resolvedTheme={resolvedTheme}
                  shouldReduceMotion={shouldReduceMotion}
                  mobileHeightMode={mobileView === "map" ? "expanded" : "compact"}
                  onSelectNode={handleSelectNode}
                  onLayoutModeChange={setLayoutMode}
                />

                {/* Compact summary bar below map when in mobile "map-only" mode */}
                {mobileView === "map" && inspector && (
                  <div className="mt-2.5 lg:hidden rounded-2xl border border-sys-border bg-sys-card p-3 flex items-center justify-between gap-2 shadow-xs">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-sys-text-primary truncate">
                        {intersection
                          ? `${inspector.node.label} ↔ ${graph.nodeMap.get(intersection.nodeBId)?.label ?? ""}`
                          : `${KIND_META[inspector.node.kind].singular}: ${inspector.node.label}`}
                      </p>
                      <p className="text-[11px] text-sys-text-secondary truncate">
                        {intersection
                          ? `Спільних: ${intersection.sharedRows.length} · Відмінних: ${intersection.onlyARows.length + intersection.onlyBRows.length}`
                          : `${graph.adjacency.get(inspector.node.id)?.size ?? 0} зв'язків · ${formatPairsLabel(inspector.node.lessonsCount)}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMobileView("list")}
                      className="shrink-0 min-h-[34px] rounded-xl bg-sys-accent px-3 py-1.5 text-xs font-semibold text-white cursor-pointer"
                    >
                      Відкрити список
                    </button>
                  </div>
                )}
              </div>

              {/* Inspector / Catalog Column */}
              <div
                className={`lg:col-span-5 xl:col-span-4 min-w-0 ${
                  mobileView === "map" ? "hidden lg:block" : "block"
                }`}
              >
                <AtlasInspectorPanel
                  graph={graph}
                  inspector={inspector}
                  compareNodeId={compareNodeId}
                  intersection={intersection}
                  courseFilter={courseFilter}
                  onSelectNode={handleSelectNode}
                  onSetCompareNode={handleSetCompareNode}
                  onSwapCompare={handleSwapCompare}
                  onPickSearchTerm={handlePickSearchTerm}
                  onAnnounceSort={setSortStatusAnnouncement}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
