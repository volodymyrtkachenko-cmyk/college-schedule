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

function searchGraphNodes(
  graph: AtlasGraph,
  query: string,
  options?: { excludeId?: string | null; limit?: number; onlyConnected?: boolean },
): AtlasGraphNode[] {
  const needle = query.trim().toLowerCase();
  const limit = options?.limit ?? 24;
  const excludeId = options?.excludeId ?? null;
  const onlyConnected = options?.onlyConnected ?? false;

  const matches: Array<{ node: AtlasGraphNode; score: number }> = [];

  for (const node of graph.nodes) {
    if (excludeId && node.id === excludeId) continue;
    if (onlyConnected && !node.isConnected) continue;

    if (!needle) {
      matches.push({ node, score: node.isConnected ? 10 : 1 });
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
      matches.push({ node, score: score + (node.isConnected ? 5 : 0) });
    }
  }

  matches.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.node.lessonsCount !== a.node.lessonsCount) return b.node.lessonsCount - a.node.lessonsCount;
    return a.node.label.localeCompare(b.node.label, "uk");
  });

  return matches.slice(0, limit).map((item) => item.node);
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

  const limit = 6;
  const visibleRows = expanded ? rows : rows.slice(0, limit);
  const hiddenCount = Math.max(0, rows.length - limit);
  const meta = KIND_META[kind];

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-sys-text-secondary">
          <span className={`inline-block h-2 w-2 rounded-full ${meta.dotClass}`} aria-hidden="true" />
          <span>{title}</span>
        </h3>
        <span className="rounded-md bg-sys-bg px-1.5 py-0.5 text-[11px] font-semibold text-sys-text-muted tabular-nums">
          {rows.length}
        </span>
      </div>

      <ul role="list" className="space-y-1.5">
        {visibleRows.map((row) => {
          const daysText = row.days.map((d) => DAY_SHORT_NAMES[d] ?? String(d)).join(", ");
          const tagsPreview = row.tags.slice(0, 2).join(" · ");
          return (
            <li key={row.node.id}>
              <button
                type="button"
                onClick={() => onSelectNode(row.node.id)}
                className="w-full min-h-[42px] rounded-xl border border-sys-border bg-sys-bg/65 hover:bg-sys-bg hover:border-sys-accent/45 px-3 py-2 text-left transition-colors cursor-pointer flex items-start justify-between gap-2.5 group"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-sys-text-primary group-hover:text-sys-accent transition-colors break-words">
                      {row.node.label}
                    </span>
                    {row.badge && (
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.pillClass}`}
                      >
                        {row.badge}
                      </span>
                    )}
                  </div>
                  {(tagsPreview || daysText) && (
                    <p className="mt-0.5 text-xs text-sys-text-secondary line-clamp-1">
                      {tagsPreview}
                      {tagsPreview && daysText ? " · " : ""}
                      {daysText && <span className="text-sys-text-muted">{daysText}</span>}
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

function CompareSummaryCard({
  graph,
  nodeA,
  nodeB,
  intersection,
  onSwap,
  onClear,
  onSelectNode,
}: {
  graph: AtlasGraph;
  nodeA: AtlasGraphNode;
  nodeB: AtlasGraphNode;
  intersection: AtlasIntersectionResult;
  onSwap: () => void;
  onClear: () => void;
  onSelectNode: (nodeId: string) => void;
}) {
  const sharedGroups = intersection.sharedByKind.groups;
  const sharedTeachers = intersection.sharedByKind.teachers;
  const sharedSubjects = intersection.sharedByKind.subjects;
  const sharedRooms = intersection.sharedByKind.rooms;
  const totalShared = intersection.sharedNodeIds.size;

  const sharedSections = (
    [
      { label: "Спільні викладачі", kind: "teacher" as const, nodes: sharedTeachers },
      { label: "Спільні предмети", kind: "subject" as const, nodes: sharedSubjects },
      { label: "Спільні групи", kind: "group" as const, nodes: sharedGroups },
      { label: "Спільні аудиторії", kind: "room" as const, nodes: sharedRooms },
    ] satisfies Array<{ label: string; kind: AtlasNodeKind; nodes: AtlasGraphNode[] }>
  ).filter((sec) => sec.nodes.length > 0);

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-sys-card p-4 shadow-xs space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-800 dark:text-amber-300">
            Перетин двох вузлів
          </p>
          <h2 className="mt-0.5 text-sm font-bold text-sys-text-primary break-words">
            {nodeA.shortLabel} <span className="text-sys-text-muted font-normal">↔</span>{" "}
            {nodeB.shortLabel}
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
            className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary transition-colors cursor-pointer"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span
          className={`inline-flex items-center rounded-lg border px-2 py-0.5 text-xs font-semibold ${
            intersection.directConnected
              ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              : "border-sys-border bg-sys-bg text-sys-text-secondary"
          }`}
        >
          {intersection.directConnected ? "Мають прямий зв'язок" : "Без прямого зв'язку"}
        </span>
        <span className="inline-flex items-center rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          Спільних вузлів: {totalShared}
        </span>
      </div>

      {totalShared === 0 ? (
        <p className="text-xs text-sys-text-secondary leading-relaxed">
          У активному розкладі ці два вузли не мають спільних викладачів, предметів, груп чи
          аудиторій. Спробуйте іншу пару для пошуку мостів.
        </p>
      ) : (
        <div className="space-y-2.5">
          {sharedSections.map((sec) => (
            <div key={sec.kind} className="space-y-1">
              <p className="text-[11px] font-semibold text-sys-text-muted uppercase tracking-wide">
                {sec.label} ({sec.nodes.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sec.nodes.map((sharedNode) => {
                  const meta = KIND_META[sharedNode.kind];
                  const deg = graph.adjacency.get(sharedNode.id)?.size ?? 0;
                  return (
                    <button
                      key={sharedNode.id}
                      type="button"
                      onClick={() => onSelectNode(sharedNode.id)}
                      title={`Відкрити паспорт: ${sharedNode.label} (${deg} зв'язків)`}
                      className={`min-h-[32px] inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer hover:brightness-95 ${meta.pillClass}`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${meta.dotClass}`}
                        aria-hidden="true"
                      />
                      <span className="max-w-[190px] truncate">{sharedNode.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AtlasInspectorPanel({
  graph,
  inspector,
  layoutMode,
  compareNodeId,
  intersection,
  onSelectNode,
  onSetCompareNode,
  onSwapCompare,
  onLayoutModeChange,
}: {
  graph: AtlasGraph;
  inspector: AtlasNodeInspectorData | null;
  layoutMode: "constellation" | "ego";
  compareNodeId: string | null;
  intersection: AtlasIntersectionResult | null;
  onSelectNode: (nodeId: string) => void;
  onSetCompareNode: (nodeId: string | null) => void;
  onSwapCompare: () => void;
  onLayoutModeChange: (mode: "constellation" | "ego") => void;
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
    const sameKindFirst = searchGraphNodes(graph, compareQuery, {
      excludeId: inspector.node.id,
      limit: 20,
      onlyConnected: true,
    });
    if (!compareQuery.trim()) {
      const sameKind = sameKindFirst.filter((n) => n.kind === inspector.node.kind);
      const others = sameKindFirst.filter((n) => n.kind !== inspector.node.kind);
      return [...sameKind, ...others].slice(0, 14);
    }
    return sameKindFirst.slice(0, 14);
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
              Оберіть будь-який вузол на мапі, у пошуку або в матриці
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-3.5 space-y-2 text-xs text-sys-text-secondary leading-relaxed">
          <p className="font-semibold text-sys-text-primary flex items-center gap-1.5">
            <InfoIcon className="w-4 h-4 text-sys-accent shrink-0" />
            <span>Що можна дослідити в Атласі</span>
          </p>
          <ul className="space-y-1.5 pl-4 list-disc">
            <li>Клік по вузлу підсвічує всіх його сусідів і відкриває повний паспорт зв&apos;язків.</li>
            <li>
              Режим <strong>«Орбіта вузла»</strong> ставить обрану групу, викладача, предмет чи
              аудиторію в центр власного графа.
            </li>
            <li>
              <strong>«Перетин»</strong> порівнює будь-які два вузли та показує спільні пари,
              викладачів і кабінети.
            </li>
          </ul>
        </div>
      </aside>
    );
  }

  const { node, curatorTeacher, curatedGroups, groups, teachers, subjects, rooms } = inspector;
  const meta = KIND_META[node.kind];
  const scheduleHref = getScheduleHref(node);
  const neighborsCount = graph.adjacency.get(node.id)?.size ?? 0;

  return (
    <aside
      aria-label={`Паспорт вузла ${node.label}`}
      className="space-y-3 xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto pr-0.5"
    >
      {intersection && compareNode && (
        <CompareSummaryCard
          graph={graph}
          nodeA={node}
          nodeB={compareNode}
          intersection={intersection}
          onSwap={onSwapCompare}
          onClear={() => onSetCompareNode(null)}
          onSelectNode={onSelectNode}
        />
      )}

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
            {node.floor !== null && (
              <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-xs font-medium text-sys-text-secondary">
                {node.floor === 0 ? "Цоколь / партер" : `${node.floor} поверх`}
              </span>
            )}
            {node.homeRoom && (
              <button
                type="button"
                onClick={() => onSelectNode(makeAtlasNodeId("room", node.homeRoom!))}
                className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:brightness-95 transition-colors cursor-pointer"
              >
                Кабінет {node.homeRoom}
              </button>
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
            onClick={() => onLayoutModeChange(layoutMode === "ego" ? "constellation" : "ego")}
            className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              layoutMode === "ego" && !intersection
                ? "border-sys-accent bg-sys-accent/12 text-sys-accent"
                : "border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/45"
            }`}
          >
            <NetworkIcon className="w-3.5 h-3.5" />
            <span>{layoutMode === "ego" ? "Повернути сузір'я" : "Орбіта вузла"}</span>
          </button>

          <button
            type="button"
            aria-expanded={compareOpen}
            onClick={() => setCompareOpen((prev) => !prev)}
            className={`min-h-[38px] inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
              compareNodeId || compareOpen
                ? "border-amber-500/45 bg-amber-500/12 text-amber-800 dark:text-amber-300"
                : "border-sys-border bg-sys-bg text-sys-text-primary hover:border-sys-accent/45"
            }`}
          >
            <BarChartIcon className="w-3.5 h-3.5" />
            <span>{compareNodeId ? "Змінити порівняння" : "Порівняти перетин"}</span>
          </button>
        </div>

        {/* Inline Compare Picker */}
        {compareOpen && (
          <div className="rounded-xl border border-sys-border bg-sys-bg p-3 space-y-2.5">
            <label htmlFor={compareInputId} className="block text-xs font-semibold text-sys-text-primary">
              Оберіть другий вузол для пошуку спільних зв&apos;язків
            </label>
            <input
              id={compareInputId}
              type="search"
              value={compareQuery}
              onChange={(e) => setCompareQuery(e.target.value)}
              placeholder="Наприклад: назва групи, викладач або кабінет..."
              className="w-full min-h-[36px] rounded-xl border border-sys-border bg-sys-card px-3 py-1.5 text-sm text-sys-text-primary placeholder:text-sys-text-muted focus:outline-none focus:border-sys-accent"
            />
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
              {compareCandidates.map((cand) => {
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
                    <span className="max-w-[170px] truncate">{cand.label}</span>
                  </button>
                );
              })}
              {compareCandidates.length === 0 && (
                <p className="text-xs text-sys-text-muted py-1">Нічого не знайдено.</p>
              )}
            </div>
          </div>
        )}

        {/* Curatorship callout */}
        {curatorTeacher && (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2.5 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                Куратор групи
              </p>
              <p className="text-sm font-semibold text-sys-text-primary truncate">
                {curatorTeacher.fullName || curatorTeacher.label}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectNode(curatorTeacher.id)}
              className="shrink-0 min-h-[34px] rounded-lg border border-emerald-500/35 bg-sys-card px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:brightness-95 transition-colors cursor-pointer"
            >
              Перейти
            </button>
          </div>
        )}

        {curatedGroups.length > 0 && (
          <div className="rounded-xl border border-blue-500/25 bg-blue-500/5 px-3 py-2.5 space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
              Кураторство груп
            </p>
            <div className="flex flex-wrap gap-1.5">
              {curatedGroups.map((cg) => (
                <button
                  key={cg.id}
                  type="button"
                  onClick={() => onSelectNode(cg.id)}
                  className="min-h-[32px] rounded-lg border border-blue-500/35 bg-sys-card px-2.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:brightness-95 transition-colors cursor-pointer"
                >
                  {cg.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Relations */}
        <div className="space-y-4 pt-1 border-t border-sys-border/70">
          {node.lessonsCount === 0 && neighborsCount === 0 ? (
            <p className="text-xs text-sys-text-secondary leading-relaxed">
              Наразі цей елемент є в довіднику, але не має активних пар у поточному тижневому
              розкладі.
            </p>
          ) : (
            <>
              <RelationListSection
                title="Предмети"
                kind="subject"
                rows={subjects}
                onSelectNode={onSelectNode}
              />
              <RelationListSection
                title="Викладачі"
                kind="teacher"
                rows={teachers}
                onSelectNode={onSelectNode}
              />
              <RelationListSection
                title="Групи"
                kind="group"
                rows={groups}
                onSelectNode={onSelectNode}
              />
              <RelationListSection
                title="Аудиторії"
                kind="room"
                rows={rooms}
                onSelectNode={onSelectNode}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function AtlasMatrixView({
  graph,
  kindFilter,
  courseFilter,
  selectedNodeId,
  onSelectNode,
}: {
  graph: AtlasGraph;
  kindFilter: "all" | AtlasNodeKind;
  courseFilter: number | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const orderedKinds: AtlasNodeKind[] =
    kindFilter === "all" ? ["group", "teacher", "subject", "room"] : [kindFilter];

  const sections = useMemo(() => {
    return orderedKinds
      .map((kind) => {
        let nodes = graph.nodes.filter((n) => n.kind === kind);
        if (kind === "group" && courseFilter !== null) {
          nodes = nodes.filter((n) => n.course === courseFilter);
        }
        nodes.sort((a, b) => {
          if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
          return a.label.localeCompare(b.label, "uk");
        });
        return { kind, nodes };
      })
      .filter((sec) => sec.nodes.length > 0);
  }, [graph, orderedKinds, courseFilter]);

  return (
    <div className="space-y-5">
      {sections.map(({ kind, nodes }) => {
        const meta = KIND_META[kind];
        return (
          <section
            key={kind}
            className="rounded-2xl border border-sys-border bg-sys-card p-4 shadow-xs space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-sys-text-primary">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${meta.dotClass}`} aria-hidden="true" />
                <span>{meta.plural}</span>
              </h2>
              <span className="rounded-lg border border-sys-border bg-sys-bg px-2 py-0.5 text-xs font-semibold text-sys-text-secondary tabular-nums">
                {nodes.length}
              </span>
            </div>

            <ul
              role="list"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
            >
              {nodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const degree = graph.adjacency.get(node.id)?.size ?? 0;
                return (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => onSelectNode(node.id)}
                      aria-pressed={isSelected}
                      className={`w-full min-h-[54px] rounded-xl border p-2.5 text-left transition-colors cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected
                          ? "border-sys-accent bg-sys-accent/12 shadow-xs"
                          : "border-sys-border bg-sys-bg/60 hover:bg-sys-bg hover:border-sys-accent/45"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-sys-text-primary truncate">
                          {node.label}
                        </p>
                        <p className="text-[11px] text-sys-text-secondary truncate">
                          {node.subtitle || `${degree} зв'язків`}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md border border-sys-border bg-sys-card px-1.5 py-0.5 text-[11px] font-semibold text-sys-text-secondary tabular-nums">
                        {node.lessonsCount > 0 ? formatPairsLabel(node.lessonsCount) : `${degree} зв.`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
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
  const [layoutMode, setLayoutMode] = useState<"constellation" | "ego">("constellation");
  const [kindFilter, setKindFilter] = useState<"all" | AtlasNodeKind>("all");
  const [courseFilter, setCourseFilter] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<"map" | "matrix">("map");

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
    if (!graph || !searchQuery.trim()) return [];
    return searchGraphNodes(graph, searchQuery, { limit: 24 });
  }, [graph, searchQuery]);

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
        if (picked) {
          if (kindFilter !== "all" && kindFilter !== picked.kind) {
            setKindFilter("all");
          }
          if (courseFilter !== null && picked.kind === "group" && picked.course !== courseFilter) {
            setCourseFilter(null);
          }
        }
      }
    },
    [compareNodeId, graph, kindFilter, courseFilter],
  );

  const handleSetCompareNode = useCallback(
    (nextCompareId: string | null) => {
      if (!nextCompareId || nextCompareId === selectedNodeId) {
        setCompareNodeId(null);
        return;
      }
      setCompareNodeId(nextCompareId);
      setKindFilter("all");
      setCourseFilter(null);
      setViewMode("map");
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

  const handlePickSearchNode = (node: AtlasGraphNode) => {
    handleSelectNode(node.id);
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
      if (target) handlePickSearchNode(target);
    }
  };

  const liveAnnouncement = useMemo(() => {
    if (!graph || !selectedNodeId) return "";
    const node = graph.nodeMap.get(selectedNodeId);
    if (!node) return "";
    const deg = graph.adjacency.get(node.id)?.size ?? 0;
    if (intersection) {
      const b = graph.nodeMap.get(intersection.nodeBId);
      return `Порівняння: ${node.label} та ${b?.label ?? ""}. Спільних вузлів: ${intersection.sharedNodeIds.size}.`;
    }
    return `Обрано ${KIND_META[node.kind].singular.toLowerCase()} ${node.label}. Зв'язків: ${deg}.`;
  }, [graph, selectedNodeId, intersection]);

  return (
    <div className="min-h-screen bg-sys-bg text-sys-text-primary flex flex-col">
      <SubpageHeader
        title="Атлас ДФКР"
        subtitle="Інтерактивна мапа зв'язків коледжу"
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
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-2xl border border-sys-border bg-sys-card animate-pulse"
                />
              ))}
            </div>
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
            {/* Compact KPI Strip */}
            <section aria-label="Зведення графа коледжу" className="grid grid-cols-2 sm:grid-cols-5 gap-2 sm:gap-2.5">
              {[
                {
                  key: "group" as const,
                  label: "Груп",
                  value: data.summary.groups_count,
                  dotClass: KIND_META.group.dotClass,
                },
                {
                  key: "teacher" as const,
                  label: "Викладачів",
                  value: data.summary.teachers_count,
                  dotClass: KIND_META.teacher.dotClass,
                },
                {
                  key: "subject" as const,
                  label: "Предметів",
                  value: data.summary.subjects_count,
                  dotClass: KIND_META.subject.dotClass,
                },
                {
                  key: "room" as const,
                  label: "Аудиторій",
                  value: data.summary.rooms_count,
                  dotClass: KIND_META.room.dotClass,
                },
                {
                  key: "all" as const,
                  label: "Зв'язків у тижні",
                  value: data.summary.edges_count,
                  dotClass: "bg-sys-text-secondary",
                },
              ].map((stat, idx) => {
                const isActiveFilter =
                  stat.key !== "all" && kindFilter === stat.key;
                return (
                  <button
                    key={stat.label}
                    type="button"
                    onClick={() => {
                      if (stat.key === "all") {
                        setKindFilter("all");
                      } else {
                        setKindFilter((prev) => (prev === stat.key ? "all" : stat.key));
                      }
                    }}
                    className={`rounded-2xl border px-3 py-2 sm:px-3.5 sm:py-2.5 text-left transition-colors cursor-pointer ${
                      idx === 4 ? "col-span-2 sm:col-span-1 flex sm:block items-center justify-between" : ""
                    } ${
                      isActiveFilter
                        ? "border-sys-accent bg-sys-accent/10"
                        : "border-sys-border bg-sys-card hover:border-sys-accent/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] sm:text-xs font-medium text-sys-text-secondary">{stat.label}</span>
                      <span className={`h-2 w-2 rounded-full ${stat.dotClass}`} aria-hidden="true" />
                    </div>
                    <p className={`${idx === 4 ? "sm:mt-1" : "mt-0.5 sm:mt-1"} text-base sm:text-xl font-bold text-sys-text-primary tabular-nums`}>
                      {stat.value}
                    </p>
                  </button>
                );
              })}
            </section>

            {/* Controls Bar: Search + Filters + View Mode Switch */}
            <section
              aria-label="Пошук та фільтри мапи"
              className="rounded-2xl border border-sys-border bg-sys-card p-2.5 sm:p-3.5 shadow-xs space-y-2.5 sm:space-y-3"
            >
              <div className="flex flex-col md:flex-row md:items-center gap-2.5">
                {/* Search Combobox */}
                <div ref={searchBoxRef} className="relative flex-1 min-w-0">
                  <label htmlFor={searchInputId} className="sr-only">
                    Пошук групи, викладача, предмета або аудиторії
                  </label>
                  <div className="relative flex items-center">
                    <SearchIcon className="w-4 h-4 text-sys-text-muted pointer-events-none absolute left-3" />
                    <input
                      id={searchInputId}
                      type="search"
                      role="combobox"
                      aria-expanded={searchOpen && searchQuery.trim().length > 0}
                      aria-controls={searchListboxId}
                      aria-autocomplete="list"
                      value={searchQuery}
                      onFocus={() => setSearchOpen(true)}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSearchOpen(true);
                      }}
                      onKeyDown={handleSearchKeyDown}
                      placeholder="Пошук групи, викладача, предмета..."
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

                  {searchOpen && searchQuery.trim().length > 0 && (
                    <div
                      id={searchListboxId}
                      role="listbox"
                      aria-label="Результати пошуку"
                      className="absolute left-0 right-0 top-full mt-1.5 z-30 max-h-80 overflow-y-auto rounded-2xl border border-sys-border bg-sys-card p-1.5 shadow-lg"
                    >
                      {searchResults.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-sys-text-muted">
                          Нічого не знайдено за запитом «{searchQuery}»
                        </p>
                      ) : (
                        searchResults.map((node, index) => {
                          const meta = KIND_META[node.kind];
                          const isHighlighted = index === activeSearchIdx;
                          return (
                            <button
                              key={node.id}
                              type="button"
                              role="option"
                              aria-selected={isHighlighted}
                              onClick={() => handlePickSearchNode(node)}
                              className={`w-full min-h-[40px] rounded-xl px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isHighlighted ? "bg-sys-accent/12" : "hover:bg-sys-bg"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-semibold text-sys-text-primary truncate">
                                  {node.fullName || node.label}
                                </p>
                                {node.subtitle && (
                                  <p className="text-[11px] text-sys-text-secondary truncate">
                                    {node.subtitle}
                                  </p>
                                )}
                              </div>
                              <span
                                className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${meta.pillClass}`}
                              >
                                {meta.singular}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>

                {/* View Mode Toggle: Map <-> Matrix */}
                <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                  <div
                    role="group"
                    aria-label="Режим відображення"
                    className="inline-flex rounded-xl border border-sys-border bg-sys-bg p-1"
                  >
                    <button
                      type="button"
                      aria-pressed={viewMode === "map"}
                      onClick={() => setViewMode("map")}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        viewMode === "map"
                          ? "bg-sys-accent text-white shadow-xs"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      Мапа графа
                    </button>
                    <button
                      type="button"
                      aria-pressed={viewMode === "matrix"}
                      onClick={() => setViewMode("matrix")}
                      className={`min-h-[34px] px-3 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                        viewMode === "matrix"
                          ? "bg-sys-accent text-white shadow-xs"
                          : "text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      Матриця
                    </button>
                  </div>
                </div>
              </div>

              {/* Filter Chips Row */}
              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: "all" as const, label: "Усі шари" },
                    { id: "group" as const, label: "Групи" },
                    { id: "teacher" as const, label: "Викладачі" },
                    { id: "subject" as const, label: "Предмети" },
                    { id: "room" as const, label: "Аудиторії" },
                  ]
                ).map((chip) => {
                  const active = kindFilter === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setKindFilter(chip.id)}
                      className={`min-h-[32px] inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
                        active
                          ? "border-sys-accent bg-sys-accent text-white"
                          : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                      }`}
                    >
                      {chip.id !== "all" && (
                        <span
                          className={`h-2 w-2 rounded-full ${
                            active ? "bg-white" : KIND_META[chip.id].dotClass
                          }`}
                          aria-hidden="true"
                        />
                      )}
                      <span>{chip.label}</span>
                    </button>
                  );
                })}

                {availableCourses.length > 0 && (
                  <>
                    <div className="w-px h-5 bg-sys-border mx-1 hidden sm:block" aria-hidden="true" />
                    <button
                      type="button"
                      aria-pressed={courseFilter === null}
                      onClick={() => setCourseFilter(null)}
                      className={`min-h-[32px] rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
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
                          onClick={() => setCourseFilter((prev) => (prev === course ? null : course))}
                          className={`min-h-[32px] rounded-xl border px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
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
            </section>

            {/* Primary Workspace Grid */}
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
              <div className="xl:col-span-8 min-w-0">
                {viewMode === "map" ? (
                  <AtlasCanvas
                    graph={graph}
                    layoutMode={layoutMode}
                    selectedNodeId={selectedNodeId}
                    compareNodeId={compareNodeId}
                    intersection={intersection}
                    kindFilter={kindFilter}
                    courseFilter={courseFilter}
                    resolvedTheme={resolvedTheme}
                    shouldReduceMotion={shouldReduceMotion}
                    onSelectNode={handleSelectNode}
                    onLayoutModeChange={setLayoutMode}
                  />
                ) : (
                  <AtlasMatrixView
                    graph={graph}
                    kindFilter={kindFilter}
                    courseFilter={courseFilter}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={(id) => handleSelectNode(id)}
                  />
                )}
              </div>

              <div className="xl:col-span-4 min-w-0">
                <AtlasInspectorPanel
                  graph={graph}
                  inspector={inspector}
                  layoutMode={layoutMode}
                  compareNodeId={compareNodeId}
                  intersection={intersection}
                  onSelectNode={handleSelectNode}
                  onSetCompareNode={handleSetCompareNode}
                  onSwapCompare={handleSwapCompare}
                  onLayoutModeChange={setLayoutMode}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
