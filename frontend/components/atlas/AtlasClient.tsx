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
  computeNodeIntersection,
  getNodeInspectorData,
  makeAtlasNodeId,
  type AtlasGraph,
  type AtlasGraphNode,
  type AtlasIntersectionResult,
  type AtlasNodeInspectorData,
  type AtlasNodeKind,
  type AtlasRelationRow,
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

        const tIds = edge.second_teacher_id ? [edge.teacher_id, edge.second_teacher_id] : [edge.teacher_id];
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
          return a.node.label.localeCompare(b.node.label, "uk");
        }
        if (b.node.lessonsCount !== a.node.lessonsCount) {
          return b.node.lessonsCount - a.node.lessonsCount;
        }
        return a.node.label.localeCompare(b.node.label, "uk");
      }
      if (b.score !== a.score) return b.score - a.score;
      if (b.node.lessonsCount !== a.node.lessonsCount) return b.node.lessonsCount - a.node.lessonsCount;
      return a.node.label.localeCompare(b.node.label, "uk");
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

function RelationListSection({
  title,
  kind,
  rows,
  onSelectNode,
}: {
  title: string;
  kind: AtlasNodeKind;
  rows: AtlasRelationRow[];
  onSelectNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) return null;

  const limit = 10;
  const visibleRows = expanded ? rows : rows.slice(0, limit);
  const hiddenCount = Math.max(0, rows.length - limit);
  const meta = KIND_META[kind];

  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
          <span className={`inline-block h-2 w-2 rounded-full ${meta.dotClass}`} aria-hidden="true" />
          <span>{title}</span>
        </h3>
        <span className="rounded-md bg-sys-bg px-1.5 py-0.5 text-[11px] font-semibold text-sys-text-muted tabular-nums">
          {rows.length}
        </span>
      </div>

      <ul role="list" className="space-y-2">
        {visibleRows.map((row) => {
          const daysText = row.days.map((d) => DAY_SHORT_NAMES[d] ?? String(d)).join(", ");
          const subjectsText = row.subjects.join(" · ");
          const roomsText = row.rooms.map((r) => `каб. ${r}`).join(", ");
          return (
            <li key={row.node.id}>
              <button
                type="button"
                onClick={() => onSelectNode(row.node.id)}
                className="w-full min-h-[44px] rounded-xl border border-sys-border bg-sys-bg/65 hover:bg-sys-bg hover:border-sys-accent/45 px-3 py-2.5 text-left transition-colors cursor-pointer flex items-start justify-between gap-2.5 group"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors break-words">
                      {row.node.fullName || row.node.label}
                    </span>
                    {row.badge && (
                      <span
                        className="inline-flex items-center rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-300"
                      >
                        {row.badge}
                      </span>
                    )}
                  </div>
                  {subjectsText && (
                    <p className="text-xs text-sys-text-secondary leading-relaxed break-words">
                      {subjectsText}
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
            </li>
          );
        })}
      </ul>

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
  emptyLabel,
  onSelectNode,
}: {
  title: string;
  accentClass: string;
  rows: AtlasRelationRow[];
  emptyLabel: string;
  onSelectNode: (nodeId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = 6;
  const visibleRows = expanded ? rows : rows.slice(0, limit);
  const hiddenCount = Math.max(0, rows.length - limit);

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

      {rows.length === 0 ? (
        <p className="text-xs text-sys-text-muted leading-relaxed">{emptyLabel}</p>
      ) : (
        <ul role="list" className="space-y-1.5">
          {visibleRows.map((row) => {
            const subjectsText = row.subjects.join(" · ");
            return (
              <li key={row.node.id}>
                <button
                  type="button"
                  onClick={() => onSelectNode(row.node.id)}
                  className="w-full rounded-lg border border-sys-border bg-sys-card hover:border-sys-accent/45 px-2.5 py-1.5 text-left transition-colors cursor-pointer space-y-0.5"
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="text-xs font-semibold text-sys-text-primary break-words">
                      {row.node.label}
                    </span>
                    {row.lessonsCount > 0 && (
                      <span className="shrink-0 text-[10px] font-semibold text-sys-text-muted tabular-nums">
                        {row.lessonsCount}п
                      </span>
                    )}
                  </div>
                  {subjectsText && (
                    <p className="text-[11px] text-sys-text-secondary leading-snug break-words">
                      {subjectsText}
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
}: {
  graph: AtlasGraph;
  nodeA: AtlasGraphNode;
  nodeB: AtlasGraphNode;
  intersection: AtlasIntersectionResult;
  onSwap: () => void;
  onClear: () => void;
  onSelectNode: (nodeId: string) => void;
  onSetCompareNode: (nodeId: string | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerInputId = useId();

  useEffect(() => {
    setPickerOpen(false);
    setPickerQuery("");
  }, [nodeA.id, nodeB.id]);

  const pickerCandidates = useMemo(() => {
    const results = searchAtlasNodes(graph, pickerQuery, {
      excludeId: nodeA.id,
      limit: 20,
      onlyConnected: true,
    });
    if (!pickerQuery.trim()) {
      const sameKind = results.filter((c) => c.node.kind === nodeA.kind);
      const others = results.filter((c) => c.node.kind !== nodeA.kind);
      return [...sameKind, ...others].slice(0, 14);
    }
    return results.slice(0, 14);
  }, [graph, nodeA.id, nodeA.kind, pickerQuery]);

  const { sharedRows, onlyARows, onlyBRows, sharedSubjects, sharedRooms } = intersection;

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-sys-card p-4 sm:p-5 shadow-xs space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Порівняння зв&apos;язків
          </p>
          <h2 className="mt-0.5 text-base font-bold text-sys-text-primary break-words">
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
        <div className="rounded-xl border border-sys-border bg-sys-bg p-3 space-y-2">
          <label htmlFor={pickerInputId} className="block text-xs font-semibold text-sys-text-primary">
            Змінити другий вузол порівняння
          </label>
          <input
            id={pickerInputId}
            type="search"
            value={pickerQuery}
            onChange={(e) => setPickerQuery(e.target.value)}
            placeholder="Назва групи, викладач або предмет..."
            className="w-full min-h-[36px] rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
          />
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
            {pickerCandidates.map(({ node: cand }) => {
              const cMeta = KIND_META[cand.kind];
              return (
                <button
                  key={cand.id}
                  type="button"
                  onClick={() => {
                    onSetCompareNode(cand.id);
                    setPickerOpen(false);
                  }}
                  className="min-h-[32px] inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card hover:border-sys-accent/50 px-2.5 py-1 text-xs font-medium text-sys-text-primary transition-colors cursor-pointer"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${cMeta.dotClass}`} aria-hidden="true" />
                  <span>{cand.label}</span>
                </button>
              );
            })}
            {pickerCandidates.length === 0 && (
              <p className="text-xs text-sys-text-muted py-1">Нічого не знайдено.</p>
            )}
          </div>
        </div>
      )}

      {/* Compact Diff Metrics */}
      <div className="flex flex-wrap gap-1.5">
        <span className="inline-flex items-center rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
          Спільних: {sharedRows.length}
        </span>
        <span className="inline-flex items-center rounded-lg border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-700 dark:text-blue-300">
          Тільки у {nodeA.label}: {onlyARows.length}
        </span>
        <span className="inline-flex items-center rounded-lg border border-sys-border bg-sys-bg px-2.5 py-1 text-xs font-semibold text-sys-text-primary">
          Тільки у {nodeB.label}: {onlyBRows.length}
        </span>
        {intersection.directConnected && (
          <span className="inline-flex items-center rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
            Прямий зв&apos;язок
          </span>
        )}
      </div>

      {/* Shared Section */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
          Спільне ({sharedRows.length > 0 ? sharedRows.length : sharedSubjects.length + sharedRooms.length})
        </h3>
        {sharedRows.length > 0 ? (
          <ul role="list" className="space-y-1.5">
            {sharedRows.map((row) => {
              const meta = KIND_META[row.node.kind];
              const subjectsText = row.subjects.join(" · ");
              const roomsText = row.rooms.map((r) => `каб. ${r}`).join(", ");
              return (
                <li key={row.node.id}>
                  <button
                    type="button"
                    onClick={() => onSelectNode(row.node.id)}
                    className="w-full rounded-xl border border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 px-3 py-2 text-left transition-colors cursor-pointer space-y-0.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1.5">
                      <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-sys-text-primary break-words">
                        <span className={`h-2 w-2 rounded-full shrink-0 ${meta.dotClass}`} aria-hidden="true" />
                        <span>{row.node.fullName || row.node.label}</span>
                      </span>
                      {row.lessonsCount > 0 && (
                        <span className="text-[11px] font-semibold text-sys-text-secondary tabular-nums">
                          {formatPairsLabel(row.lessonsCount)}
                        </span>
                      )}
                    </div>
                    {(subjectsText || roomsText) && (
                      <p className="text-xs text-sys-text-secondary break-words">
                        {subjectsText}
                        {subjectsText && roomsText ? " · " : ""}
                        {roomsText}
                      </p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : sharedSubjects.length > 0 || sharedRooms.length > 0 ? (
          <div className="rounded-xl border border-sys-border bg-sys-bg/65 p-2.5 space-y-1.5">
            {sharedSubjects.length > 0 && (
              <p className="text-xs text-sys-text-secondary leading-relaxed">
                <span className="font-semibold text-sys-text-primary">Спільні предмети: </span>
                {sharedSubjects.map((s) => s.label).join(", ")}
              </p>
            )}
            {sharedRooms.length > 0 && (
              <p className="text-xs text-sys-text-secondary leading-relaxed">
                <span className="font-semibold text-sys-text-primary">Спільні кабінети: </span>
                {sharedRooms.map((r) => `каб. ${r.name}`).join(", ")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-sys-text-muted leading-relaxed">
            У активному розкладі спільних викладачів чи груп не знайдено.
          </p>
        )}
      </section>

      {/* Differences Section: Clear side-by-side comparison */}
      <section className="space-y-2 pt-2 border-t border-sys-border/70">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
          Що відрізняється
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <CompareDiffColumn
            title={`Тільки у ${nodeA.label}`}
            accentClass="text-blue-700 dark:text-blue-300"
            rows={onlyARows}
            emptyLabel="Усі зв'язки є спільними"
            onSelectNode={onSelectNode}
          />
          <CompareDiffColumn
            title={`Тільки у ${nodeB.label}`}
            accentClass="text-sys-text-primary"
            rows={onlyBRows}
            emptyLabel="Усі зв'язки є спільними"
            onSelectNode={onSelectNode}
          />
        </div>
      </section>
    </div>
  );
}

function AtlasInspectorPanel({
  graph,
  inspector,
  compareNodeId,
  intersection,
  onSelectNode,
  onSetCompareNode,
  onSwapCompare,
}: {
  graph: AtlasGraph;
  inspector: AtlasNodeInspectorData | null;
  compareNodeId: string | null;
  intersection: AtlasIntersectionResult | null;
  onSelectNode: (nodeId: string) => void;
  onSetCompareNode: (nodeId: string | null) => void;
  onSwapCompare: () => void;
}) {
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareQuery, setCompareQuery] = useState("");
  const compareInputId = useId();

  useEffect(() => {
    setCompareOpen(false);
    setCompareQuery("");
  }, [inspector?.node.id]);

  const compareNode = compareNodeId ? (graph.nodeMap.get(compareNodeId) ?? null) : null;

  const compareCandidates = useMemo(() => {
    if (!inspector) return [];
    const results = searchAtlasNodes(graph, compareQuery, {
      excludeId: inspector.node.id,
      limit: 20,
      onlyConnected: true,
    });
    if (!compareQuery.trim()) {
      const sameKind = results.filter((c) => c.node.kind === inspector.node.kind);
      const others = results.filter((c) => c.node.kind !== inspector.node.kind);
      return [...sameKind, ...others].slice(0, 14);
    }
    return results.slice(0, 14);
  }, [graph, inspector, compareQuery]);

  if (!inspector) {
    return (
      <aside
        aria-label="Паспорт вузла"
        className="rounded-2xl border border-sys-border bg-sys-card p-5 shadow-xs space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sys-border bg-sys-bg text-sys-accent">
            <NetworkIcon className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-sys-text-primary">Паспорт вузла</h2>
            <p className="text-xs text-sys-text-secondary">
              Оберіть групу або викладача на мапі чи через пошук
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-3.5 space-y-2 text-xs text-sys-text-secondary leading-relaxed">
          <p className="font-semibold text-sys-text-primary flex items-center gap-1.5">
            <InfoIcon className="w-4 h-4 text-sys-accent shrink-0" />
            <span>Як працювати з Атласом</span>
          </p>
          <ul className="space-y-1.5 pl-4 list-disc">
            <li>Клік по сусіду на орбіті ставить його у центр і відкриває його зв&apos;язки.</li>
            <li>
              Перемикач <strong>«Весь коледж»</strong> показує карту усіх груп і викладачів
              разом.
            </li>
            <li>
              <strong>«Порівняти перетин»</strong> знаходить спільних викладачів, групи, предмети
              та кабінети для двох обраних вузлів.
            </li>
          </ul>
        </div>
      </aside>
    );
  }

  const { node, groups, teachers } = inspector;
  const meta = KIND_META[node.kind];
  const scheduleHref = getScheduleHref(node);
  const neighborsCount = graph.adjacency.get(node.id)?.size ?? 0;

  if (intersection && compareNode) {
    return (
      <aside
        aria-label={`Порівняння ${node.label} та ${compareNode.label}`}
        className="space-y-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto pr-0.5"
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
        />
      </aside>
    );
  }

  return (
    <aside
      aria-label={`Паспорт вузла ${node.label}`}
      className="space-y-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto pr-0.5"
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

          <h2 className="text-lg sm:text-xl font-bold text-sys-text-primary leading-snug break-words">
            {node.fullName || node.label}
          </h2>

          {node.fullName && node.fullName !== node.label && (
            <p className="text-xs font-medium text-sys-text-secondary">
              У розкладі: <span className="text-sys-text-primary font-semibold">{node.label}</span>
            </p>
          )}

          {/* Contextual chips */}
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

        {/* Inline Compare Picker */}
        {compareOpen && (
          <div className="rounded-xl border border-sys-border bg-sys-bg p-3 space-y-2.5">
            <label htmlFor={compareInputId} className="block text-xs font-semibold text-sys-text-primary">
              Оберіть другу групу або викладача для порівняння
            </label>
            <input
              id={compareInputId}
              type="search"
              value={compareQuery}
              onChange={(e) => setCompareQuery(e.target.value)}
              placeholder="Наприклад: назва групи, викладач або предмет..."
              className="w-full min-h-[36px] rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
            />
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {compareCandidates.map(({ node: cand }) => {
                const cMeta = KIND_META[cand.kind];
                return (
                  <button
                    key={cand.id}
                    type="button"
                    onClick={() => {
                      onSetCompareNode(cand.id);
                      setCompareOpen(false);
                    }}
                    className="min-h-[32px] inline-flex items-center gap-1.5 rounded-lg border border-sys-border bg-sys-card hover:border-sys-accent/50 px-2.5 py-1 text-xs font-medium text-sys-text-primary transition-colors cursor-pointer"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${cMeta.dotClass}`} aria-hidden="true" />
                    <span>{cand.label}</span>
                  </button>
                );
              })}
              {compareCandidates.length === 0 && (
                <p className="text-xs text-sys-text-muted py-1">Нічого не знайдено.</p>
              )}
            </div>
          </div>
        )}

        {/* Unified Relations & Subjects/Rooms List */}
        <div className="pt-2 border-t border-sys-border/70">
          {node.lessonsCount === 0 && neighborsCount === 0 ? (
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              Наразі цей елемент є в довіднику, але не має активних пар у поточному тижневому
              розкладі.
            </p>
          ) : (
            <div className="space-y-4">
              <RelationListSection
                title="Викладачі, предмети та кабінети"
                kind="teacher"
                rows={teachers}
                onSelectNode={onSelectNode}
              />
              <RelationListSection
                title="Групи, предмети та кабінети"
                kind="group"
                rows={groups}
                onSelectNode={onSelectNode}
              />
            </div>
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
  const [compareNodeId, setCompareNodeId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<"constellation" | "ego">("ego");
  const [courseFilter, setCourseFilter] = useState<number | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIdx, setActiveSearchIdx] = useState(0);

  const initialFocusedRef = useRef(false);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);
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

      try {
        const storedMode = window.localStorage.getItem("schedule:mode");
        const storedGroupId = Number(window.localStorage.getItem("schedule:groupId")) || null;
        const storedTeacherId = Number(window.localStorage.getItem("schedule:teacherId")) || null;

        if (storedMode === "teacher" && storedTeacherId) {
          const tid = makeAtlasNodeId("teacher", storedTeacherId);
          if (graph.nodeMap.has(tid)) {
            setSelectedNodeId(tid);
            return;
          }
        }
        if (storedGroupId) {
          const gid = makeAtlasNodeId("group", storedGroupId);
          if (graph.nodeMap.has(gid)) {
            setSelectedNodeId(gid);
            return;
          }
        }
      } catch {
        // Ignore storage errors in restricted environments
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

  const handleSelectNode = useCallback(
    (nodeId: string | null) => {
      setSelectedNodeId(nodeId);
      if (nodeId && compareNodeId === nodeId) {
        setCompareNodeId(null);
      }
      if (nodeId && graph) {
        const picked = graph.nodeMap.get(nodeId);
        if (picked && courseFilter !== null && picked.kind === "group" && picked.course !== courseFilter) {
          setCourseFilter(null);
        }
      }
    },
    [compareNodeId, graph, courseFilter],
  );

  const handleCourseFilterSelect = useCallback(
    (course: number | null) => {
      const next = courseFilter === course ? null : course;
      setCourseFilter(next);
      if (next !== null && graph) {
        const current = selectedNodeId ? graph.nodeMap.get(selectedNodeId) : null;
        if (!current || current.kind !== "group" || current.course !== next) {
          const busiestInCourse = graph.nodes
            .filter((n) => n.kind === "group" && n.course === next)
            .sort((a, b) => b.lessonsCount - a.lessonsCount || a.label.localeCompare(b.label, "uk"))[0];
          if (busiestInCourse) {
            setSelectedNodeId(busiestInCourse.id);
            setCompareNodeId(null);
          }
        }
      }
    },
    [courseFilter, graph, selectedNodeId],
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
        className="flex-1 w-full max-w-[1600px] mx-auto px-3 sm:px-6 pt-3 sm:pt-5 pb-24 sm:pb-12 space-y-3 sm:space-y-4 focus:outline-none"
      >
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        {/* Loading Skeleton */}
        {loading && !data && (
          <div className="space-y-4" aria-busy="true">
            <div className="h-14 rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-8 h-[460px] sm:h-[540px] lg:h-[680px] rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
              <div className="xl:col-span-4 h-[460px] rounded-2xl border border-sys-border bg-sys-card animate-pulse" />
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
            {/* Compact Toolbar: Search + Course Filter Pills */}
            <section
              aria-label="Пошук та фільтр курсів"
              className="relative z-30 rounded-2xl border border-sys-border bg-sys-card p-2.5 sm:p-3 shadow-xs flex flex-col lg:flex-row lg:items-center gap-2.5"
            >
              {/* Search Combobox */}
              <div ref={searchBoxRef} className="relative flex-1 min-w-0">
                <label htmlFor={searchInputId} className="sr-only">
                  Пошук групи, викладача або предмета
                </label>
                <div className="relative flex items-center">
                  <SearchIcon className="w-4 h-4 text-sys-text-muted pointer-events-none absolute left-3" />
                  <input
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
                    className="absolute left-0 right-0 top-full mt-1.5 z-40 max-h-80 overflow-y-auto rounded-2xl border border-sys-elevated-border bg-sys-card/95 backdrop-blur-xl p-1.5 shadow-xl"
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
                                  {node.fullName || node.label}
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

              {/* Course Filter Pills */}
              {availableCourses.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    aria-pressed={courseFilter === null}
                    onClick={() => handleCourseFilterSelect(null)}
                    className={`min-h-[34px] rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                      courseFilter === null
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
                        className={`min-h-[34px] rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? "border-sys-accent bg-sys-accent text-white"
                            : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                        }`}
                      >
                        {course} курс
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Primary Workspace Grid */}
            <div className="relative z-10 grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              <div className="xl:col-span-8 min-w-0">
                <AtlasCanvas
                  graph={graph}
                  layoutMode={layoutMode}
                  selectedNodeId={selectedNodeId}
                  compareNodeId={compareNodeId}
                  intersection={intersection}
                  courseFilter={courseFilter}
                  resolvedTheme={resolvedTheme}
                  shouldReduceMotion={shouldReduceMotion}
                  onSelectNode={handleSelectNode}
                  onLayoutModeChange={setLayoutMode}
                />
              </div>

              <div className="xl:col-span-4 min-w-0">
                <AtlasInspectorPanel
                  graph={graph}
                  inspector={inspector}
                  compareNodeId={compareNodeId}
                  intersection={intersection}
                  onSelectNode={handleSelectNode}
                  onSetCompareNode={handleSetCompareNode}
                  onSwapCompare={handleSwapCompare}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
