"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeCompareLayout,
  computeEgoLayout,
  type AtlasGraph,
  type AtlasGraphNode,
  type AtlasIntersectionResult,
  type AtlasLayoutSnapshot,
  type AtlasNodeKind,
  type AtlasNodePosition,
} from "@/lib/atlas/graphEngine";

interface AtlasCanvasProps {
  graph: AtlasGraph;
  layoutMode: "constellation" | "ego";
  selectedNodeId: string | null;
  compareNodeId: string | null;
  intersection: AtlasIntersectionResult | null;
  courseFilter: number | null;
  resolvedTheme: "light" | "dark";
  shouldReduceMotion: boolean;
  mobileHeightMode?: "compact" | "expanded";
  onSelectNode: (nodeId: string | null) => void;
  onLayoutModeChange: (nextMode: "constellation" | "ego") => void;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

interface ThemePalette {
  isDark: boolean;
  bg: Rgb;
  card: Rgb;
  border: Rgb;
  textPrimary: Rgb;
  textSecondary: Rgb;
  textMuted: Rgb;
  accent: Rgb;
  kinds: Record<AtlasNodeKind, Rgb>;
  sharedGold: Rgb;
  compareB: Rgb;
}

interface LabelBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

function parseRgbTriplet(raw: string, fallback: Rgb): Rgb {
  const parts = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (parts.length >= 3 && parts.slice(0, 3).every((n) => !Number.isNaN(n))) {
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return fallback;
}

function rgba(c: Rgb, alpha: number): string {
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

function readPaletteFromDom(resolvedTheme: "light" | "dark"): ThemePalette {
  const isDark = resolvedTheme === "dark";
  if (typeof window === "undefined") {
    return {
      isDark,
      bg: isDark ? { r: 8, g: 13, b: 24 } : { r: 241, g: 245, b: 251 },
      card: isDark ? { r: 17, g: 26, b: 46 } : { r: 255, g: 255, b: 255 },
      border: isDark ? { r: 32, g: 49, b: 82 } : { r: 203, g: 216, b: 235 },
      textPrimary: isDark ? { r: 248, g: 250, b: 252 } : { r: 15, g: 23, b: 42 },
      textSecondary: isDark ? { r: 186, g: 203, b: 227 } : { r: 51, g: 65, b: 85 },
      textMuted: isDark ? { r: 144, g: 165, b: 196 } : { r: 75, g: 92, b: 115 },
      accent: isDark ? { r: 96, g: 165, b: 250 } : { r: 29, g: 78, b: 216 },
      kinds: {
        group: isDark ? { r: 96, g: 165, b: 250 } : { r: 29, g: 78, b: 216 },
        teacher: isDark ? { r: 52, g: 211, b: 153 } : { r: 5, g: 150, b: 105 },
        subject: isDark ? { r: 167, g: 139, b: 250 } : { r: 109, g: 40, b: 217 },
        room: isDark ? { r: 251, g: 191, b: 36 } : { r: 180, g: 83, b: 9 },
      },
      sharedGold: isDark ? { r: 251, g: 191, b: 36 } : { r: 217, g: 119, b: 6 },
      compareB: isDark ? { r: 244, g: 114, b: 182 } : { r: 190, g: 24, b: 93 },
    };
  }

  const cs = getComputedStyle(document.documentElement);
  const accent = parseRgbTriplet(
    cs.getPropertyValue("--sys-accent"),
    isDark ? { r: 96, g: 165, b: 250 } : { r: 29, g: 78, b: 216 },
  );

  return {
    isDark,
    bg: parseRgbTriplet(
      cs.getPropertyValue("--sys-bg"),
      isDark ? { r: 8, g: 13, b: 24 } : { r: 241, g: 245, b: 251 },
    ),
    card: parseRgbTriplet(
      cs.getPropertyValue("--sys-card"),
      isDark ? { r: 17, g: 26, b: 46 } : { r: 255, g: 255, b: 255 },
    ),
    border: parseRgbTriplet(
      cs.getPropertyValue("--sys-border"),
      isDark ? { r: 32, g: 49, b: 82 } : { r: 203, g: 216, b: 235 },
    ),
    textPrimary: parseRgbTriplet(
      cs.getPropertyValue("--sys-text-primary"),
      isDark ? { r: 248, g: 250, b: 252 } : { r: 15, g: 23, b: 42 },
    ),
    textSecondary: parseRgbTriplet(
      cs.getPropertyValue("--sys-text-secondary"),
      isDark ? { r: 186, g: 203, b: 227 } : { r: 51, g: 65, b: 85 },
    ),
    textMuted: parseRgbTriplet(
      cs.getPropertyValue("--sys-text-muted"),
      isDark ? { r: 144, g: 165, b: 196 } : { r: 75, g: 92, b: 115 },
    ),
    accent,
    kinds: {
      group: accent,
      teacher: isDark ? { r: 52, g: 211, b: 153 } : { r: 5, g: 150, b: 105 },
      subject: isDark ? { r: 167, g: 139, b: 250 } : { r: 109, g: 40, b: 217 },
      room: isDark ? { r: 251, g: 191, b: 36 } : { r: 180, g: 83, b: 9 },
    },
    sharedGold: isDark ? { r: 251, g: 191, b: 36 } : { r: 217, g: 119, b: 6 },
    compareB: isDark ? { r: 244, g: 114, b: 182 } : { r: 190, g: 24, b: 93 },
  };
}

function easeOutCubic(t: number): number {
  const inv = 1 - Math.max(0, Math.min(1, t));
  return 1 - inv * inv * inv;
}

function boxesOverlap(a: LabelBox, b: LabelBox, margin = 4): boolean {
  return !(
    a.x2 + margin < b.x1 ||
    a.x1 - margin > b.x2 ||
    a.y2 + margin < b.y1 ||
    a.y1 - margin > b.y2
  );
}

function compactCanvasSubtitleLine(text: string, maxChars = 32): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const roomIdx = trimmed.lastIndexOf(" · каб. ");
  if (roomIdx > 4) {
    const prefix = trimmed.slice(0, roomIdx).trim();
    const suffix = trimmed.slice(roomIdx); // " · каб. XXX"
    const budget = maxChars - suffix.length - 1;
    if (budget >= 8 && prefix.length > budget) {
      return `${prefix.slice(0, budget).trimEnd()}…${suffix}`;
    }
  }

  return `${trimmed.slice(0, Math.max(8, maxChars - 1)).trimEnd()}…`;
}

function wrapSubtitleText(
  text: string,
  maxChars = 32,
  singleLine = false,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (singleLine) {
    return [compactCanvasSubtitleLine(trimmed, maxChars)];
  }
  if (trimmed.length <= maxChars) return [trimmed];

  // Keep "каб. 123" together on one line
  const protectedText = trimmed.replace(/\bкаб\.\s+/g, "каб.\u00A0");
  const words = protectedText.split(/\s+/);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  if (lines.length > 2) {
    const balancedMax = Math.min(maxChars + 4, Math.ceil(trimmed.length / 2) + 3);
    const twoLines: string[] = [];
    let buf = "";
    for (const word of words) {
      if (!buf) {
        buf = word;
      } else if (buf.length + 1 + word.length <= balancedMax && twoLines.length === 0) {
        buf = `${buf} ${word}`;
      } else if (twoLines.length === 0) {
        twoLines.push(buf);
        buf = word;
      } else {
        buf = `${buf} ${word}`;
      }
    }
    if (buf) twoLines.push(buf);
    return twoLines.map((l, idx) => {
      const clean = l.replace(/\u00A0/g, " ").trim();
      return idx === 1 && clean.length > maxChars + 4
        ? compactCanvasSubtitleLine(clean, maxChars + 3)
        : clean;
    });
  }

  return lines.map((l) => l.replace(/\u00A0/g, " ").trim());
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (typeof ctx.roundRect === "function") {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

const MIN_ZOOM = 0.16;
const MAX_ZOOM = 2.8;

export function AtlasCanvas({
  graph,
  layoutMode,
  selectedNodeId,
  compareNodeId,
  intersection,
  courseFilter,
  resolvedTheme,
  shouldReduceMotion,
  mobileHeightMode = "compact",
  onSelectNode,
  onLayoutModeChange,
}: AtlasCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const paletteRef = useRef<ThemePalette>(readPaletteFromDom(resolvedTheme));
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  // Viewport size in CSS pixels
  const sizeRef = useRef<{ width: number; height: number; dpr: number }>({
    width: 800,
    height: 600,
    dpr: 1,
  });

  // Camera state: world coords (x, y) positioned at center of viewport, plus zoom multiplier
  const cameraRef = useRef<{ x: number; y: number; zoom: number }>({
    x: 0,
    y: 0,
    zoom: 0.45,
  });

  // Camera tween state
  const cameraTweenRef = useRef<{
    startX: number;
    startY: number;
    startZoom: number;
    targetX: number;
    targetY: number;
    targetZoom: number;
    startTime: number;
    duration: number;
  } | null>(null);

  // Node position morphing state (constellation <-> ego <-> compare)
  const renderPosRef = useRef<Map<string, AtlasNodePosition>>(new Map());
  const posTweenRef = useRef<{
    from: Map<string, AtlasNodePosition>;
    to: Map<string, AtlasNodePosition>;
    startTime: number;
    duration: number;
  } | null>(null);

  const labelWidthCacheRef = useRef<Map<string, number>>(new Map());
  const rafIdRef = useRef<number | null>(null);
  const initializedFitRef = useRef(false);

  // Multi-touch & pointer drag state
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
    lastTapTime: number;
    lastTapNodeId: string | null;
  }>({
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    moved: false,
    lastTapTime: 0,
    lastTapNodeId: null,
  });
  const pinchStateRef = useRef<{
    initialDist: number;
    initialZoom: number;
    worldMidX: number;
    worldMidY: number;
  } | null>(null);

  // Compute active target layout snapshot
  const activeLayout = useMemo<AtlasLayoutSnapshot>(() => {
    if (intersection) {
      return computeCompareLayout(graph, intersection);
    }
    if (layoutMode === "ego" && selectedNodeId && graph.nodeMap.has(selectedNodeId)) {
      return computeEgoLayout(graph, selectedNodeId);
    }
    const visibleNodeIds = new Set<string>();
    const positions = new Map<string, AtlasNodePosition>();
    for (const node of graph.nodes) {
      if (node.isConnected || node.id === selectedNodeId || node.id === compareNodeId) {
        visibleNodeIds.add(node.id);
        positions.set(node.id, {
          x: node.x,
          y: node.y,
          radius: node.radius,
          angle: node.angle,
        });
      }
    }
    return {
      visibleNodeIds,
      positions,
      rings: graph.rings.map((r) => ({ radius: r.radius, label: r.label })),
      bounds: graph.bounds,
    };
  }, [graph, layoutMode, selectedNodeId, compareNodeId, intersection]);

  // Compute course-matching group & connected set so course filter cleanly highlights all groups of that course
  const courseRelevantIds = useMemo<Set<string> | null>(() => {
    if (courseFilter === null) return null;
    const set = new Set<string>();
    for (const node of graph.nodes) {
      if (node.kind === "group" && node.course === courseFilter) {
        set.add(node.id);
        for (const nb of Array.from(graph.adjacency.get(node.id) ?? [])) {
          set.add(nb);
        }
      }
    }
    return set;
  }, [graph, courseFilter]);

  // Framing bounds around all connected groups of the selected course
  const courseBounds = useMemo<{ minX: number; maxX: number; minY: number; maxY: number } | null>(() => {
    if (courseFilter === null) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let count = 0;
    for (const node of graph.nodes) {
      if (!node.isConnected || node.kind !== "group" || node.course !== courseFilter) continue;
      count++;
      const pad = node.radius + 140;
      if (node.x - pad < minX) minX = node.x - pad;
      if (node.x + pad > maxX) maxX = node.x + pad;
      if (node.y - pad < minY) minY = node.y - pad;
      if (node.y + pad > maxY) maxY = node.y + pad;
    }
    if (count === 0) return null;
    return { minX, maxX, minY, maxY };
  }, [graph, courseFilter]);

  const computeFitTransform = useCallback(
    (bounds: { minX: number; maxX: number; minY: number; maxY: number }) => {
      const { width, height } = sizeRef.current;
      const bw = Math.max(200, bounds.maxX - bounds.minX);
      const bh = Math.max(200, bounds.maxY - bounds.minY);
      const padX = width < 640 ? 46 : 72;
      const topPad = width < 640 ? 56 : 64;
      const bottomPad = width < 640 ? 52 : 60;
      const availW = Math.max(120, width - padX * 2);
      const availH = Math.max(120, height - topPad - bottomPad);
      const fitZoom = Math.max(MIN_ZOOM, Math.min(1.45, Math.min(availW / bw, availH / bh)));
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2 - (topPad - bottomPad) / (2 * fitZoom);
      return { x: cx, y: cy, zoom: fitZoom };
    },
    [],
  );

  const latestDrawStateRef = useRef({
    activeLayout,
    compareNodeId,
    courseFilter,
    courseRelevantIds,
    graph,
    hoveredNodeId,
    intersection,
    layoutMode,
    selectedNodeId,
  });
  latestDrawStateRef.current = {
    activeLayout,
    compareNodeId,
    courseFilter,
    courseRelevantIds,
    graph,
    hoveredNodeId,
    intersection,
    layoutMode,
    selectedNodeId,
  };

  const drawCanvasFrame = useCallback((now: number): boolean => {
    const canvas = canvasRef.current;
    if (!canvas) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;

    const {
      activeLayout: curLayout,
      compareNodeId: curCompareNodeId,
      courseFilter: curCourseFilter,
      courseRelevantIds: curCourseRelevantIds,
      graph: curGraph,
      hoveredNodeId: curHoveredNodeId,
      intersection: curIntersection,
      layoutMode: curLayoutMode,
      selectedNodeId: curSelectedNodeId,
    } = latestDrawStateRef.current;

    let needsNextFrame = false;

    // 1. Advance camera tween if active
    const camTween = cameraTweenRef.current;
    if (camTween) {
      const rawT = camTween.duration <= 0 ? 1 : (now - camTween.startTime) / camTween.duration;
      const t = easeOutCubic(rawT);
      cameraRef.current.x = camTween.startX + (camTween.targetX - camTween.startX) * t;
      cameraRef.current.y = camTween.startY + (camTween.targetY - camTween.startY) * t;
      cameraRef.current.zoom = camTween.startZoom + (camTween.targetZoom - camTween.startZoom) * t;
      if (rawT < 1) {
        needsNextFrame = true;
      } else {
        cameraTweenRef.current = null;
      }
    }

    // 2. Advance node position morph tween if active
    const posTween = posTweenRef.current;
    if (posTween) {
      const rawT = posTween.duration <= 0 ? 1 : (now - posTween.startTime) / posTween.duration;
      const t = easeOutCubic(rawT);
      const nextMap = new Map<string, AtlasNodePosition>();
      for (const [id, toPos] of Array.from(posTween.to.entries())) {
        const fromPos = posTween.from.get(id) ?? toPos;
        nextMap.set(id, {
          x: fromPos.x + (toPos.x - fromPos.x) * t,
          y: fromPos.y + (toPos.y - fromPos.y) * t,
          radius: fromPos.radius + (toPos.radius - fromPos.radius) * t,
          angle: toPos.angle,
          subtitle: toPos.subtitle,
        });
      }
      renderPosRef.current = nextMap;
      if (rawT < 1) {
        needsNextFrame = true;
      } else {
        posTweenRef.current = null;
      }
    }

    const { width, height, dpr } = sizeRef.current;
    const cam = cameraRef.current;
    const palette = paletteRef.current;

    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Subtle atmospheric backdrop aura centered at graph origin
    const originScreenX = (0 - cam.x) * cam.zoom + width / 2;
    const originScreenY = (0 - cam.y) * cam.zoom + height / 2;
    const maxDim = Math.max(width, height);
    const bgGrad = ctx.createRadialGradient(
      originScreenX,
      originScreenY,
      12,
      originScreenX,
      originScreenY,
      maxDim * 0.72,
    );
    bgGrad.addColorStop(0, rgba(palette.accent, palette.isDark ? 0.08 : 0.06));
    bgGrad.addColorStop(0.55, rgba(palette.kinds.subject, palette.isDark ? 0.03 : 0.02));
    bgGrad.addColorStop(1, rgba(palette.bg, 0));
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    const toScreen = (wx: number, wy: number) => ({
      x: (wx - cam.x) * cam.zoom + width / 2,
      y: (wy - cam.y) * cam.zoom + height / 2,
    });

    // 3. Draw concentric orbit rings
    if (curLayout.rings.length > 0) {
      ctx.save();
      ctx.font = "600 10px var(--font-manrope), system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const ring of curLayout.rings) {
        const rScreen = ring.radius * cam.zoom;
        if (rScreen < 20 || rScreen > Math.max(width, height) * 3) continue;
        ctx.beginPath();
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = rgba(palette.border, palette.isDark ? 0.55 : 0.72);
        ctx.lineWidth = 1;
        ctx.arc(originScreenX, originScreenY, rScreen, 0, Math.PI * 2);
        ctx.stroke();

        // Only draw ring category headers in multi-ring constellation mode so 12-o'clock orbit nodes stay unobstructed
        if (rScreen > 80 && curLayoutMode === "constellation" && !curIntersection) {
          ctx.setLineDash([]);
          ctx.fillStyle = rgba(palette.textMuted, 0.7);
          ctx.fillText(ring.label.toUpperCase(), originScreenX, originScreenY - rScreen - 10);
        }
      }
      ctx.restore();
    }

    const focusId = curHoveredNodeId ?? curSelectedNodeId;
    const focusAdj = focusId ? curGraph.adjacency.get(focusId) ?? null : null;
    const hasHighlightContext = Boolean(curIntersection || focusId || curCourseFilter !== null);

    // Helper to determine node emphasis alpha
    const getNodeAlpha = (node: AtlasGraphNode): number => {
      if (!curLayout.visibleNodeIds.has(node.id)) return 0;

      let alpha = 1;
      if (curIntersection) {
        if (
          node.id === curIntersection.nodeAId ||
          node.id === curIntersection.nodeBId ||
          curIntersection.sharedNodeIds.has(node.id)
        ) {
          return 1;
        }
        if (
          curIntersection.onlyAIds.has(node.id) ||
          curIntersection.onlyBIds.has(node.id)
        ) {
          return 0.94;
        }
        return 0.34;
      }

      if (focusId) {
        if (node.id === focusId) return 1;
        if (focusAdj?.has(node.id)) return 0.96;
        alpha = 0.14;
      }

      if (curCourseFilter !== null && curLayoutMode === "constellation" && !focusId) {
        if (node.kind === "group" && node.course === curCourseFilter) return 1;
        if (curCourseRelevantIds?.has(node.id)) return 0.72;
        return 0.14;
      }

      if (curLayoutMode === "constellation" && curCourseRelevantIds && !curCourseRelevantIds.has(node.id)) {
        alpha = Math.min(alpha, 0.16);
      }
      return alpha;
    };

    // 4. Draw edges
    const visibleIds = curLayout.visibleNodeIds;
    for (const link of curGraph.links) {
      if (!visibleIds.has(link.source) || !visibleIds.has(link.target)) continue;
      const posA = renderPosRef.current.get(link.source);
      const posB = renderPosRef.current.get(link.target);
      if (!posA || !posB) continue;

      let edgeAlpha = 0;
      let edgeColor = palette.border;
      let lineWidth = 1;

      if (curIntersection) {
        const touchesA = link.source === curIntersection.nodeAId || link.target === curIntersection.nodeAId;
        const touchesB = link.source === curIntersection.nodeBId || link.target === curIntersection.nodeBId;
        const otherId =
          link.source === curIntersection.nodeAId || link.source === curIntersection.nodeBId
            ? link.target
            : link.source;

        if (!touchesA && !touchesB) continue;
        if (touchesA && touchesB) {
          edgeColor = palette.sharedGold;
          edgeAlpha = 0.92;
          lineWidth = 2.6;
        } else if (curIntersection.sharedNodeIds.has(otherId)) {
          edgeColor = touchesA ? palette.accent : palette.compareB;
          edgeAlpha = 0.74;
          lineWidth = 1.9;
        } else if (curIntersection.onlyAIds.has(otherId) || curIntersection.onlyBIds.has(otherId)) {
          edgeColor = touchesA ? palette.accent : palette.compareB;
          edgeAlpha = 0.65;
          lineWidth = 1.75;
        } else {
          edgeColor = touchesA ? palette.accent : palette.compareB;
          edgeAlpha = 0.16;
          lineWidth = 0.95;
        }
      } else if (focusId) {
        const touchesFocus = link.source === focusId || link.target === focusId;
        if (touchesFocus) {
          const otherNode = curGraph.nodeMap.get(link.source === focusId ? link.target : link.source);
          edgeColor = link.kind === "curator"
            ? palette.sharedGold
            : otherNode
              ? palette.kinds[otherNode.kind]
              : palette.accent;
          edgeAlpha = 0.62;
          lineWidth = Math.min(2.8, 1.1 + link.weight * 0.22);
        } else {
          if (!link.isPrimaryRingEdge) continue;
          edgeColor = palette.border;
          edgeAlpha = 0.04;
          lineWidth = 0.75;
        }
      } else {
        if (!link.isPrimaryRingEdge) continue;
        if (curCourseFilter !== null) {
          const srcNode = curGraph.nodeMap.get(link.source);
          const tgtNode = curGraph.nodeMap.get(link.target);
          const touchesCourseGroup =
            (srcNode?.kind === "group" && srcNode.course === curCourseFilter) ||
            (tgtNode?.kind === "group" && tgtNode.course === curCourseFilter);
          if (touchesCourseGroup) {
            edgeColor = link.kind === "curator" ? palette.sharedGold : palette.accent;
            edgeAlpha = link.kind === "curator" ? 0.45 : 0.24;
            lineWidth = link.kind === "curator" ? 1.6 : 1.1;
          } else {
            edgeColor = palette.border;
            edgeAlpha = 0.03;
            lineWidth = 0.8;
          }
        } else {
          edgeColor = link.kind === "curator" ? palette.sharedGold : palette.textMuted;
          edgeAlpha = link.kind === "curator" ? 0.32 : palette.isDark ? 0.12 : 0.14;
          lineWidth = link.kind === "curator" ? 1.5 : 0.9;
        }
      }

      const pA = toScreen(posA.x, posA.y);
      const pB = toScreen(posB.x, posB.y);
      if (
        Math.max(pA.x, pB.x) < -80 ||
        Math.min(pA.x, pB.x) > width + 80 ||
        Math.max(pA.y, pB.y) < -80 ||
        Math.min(pA.y, pB.y) > height + 80
      ) {
        continue;
      }

      const mx = (pA.x + pB.x) * 0.5;
      const my = (pA.y + pB.y) * 0.5;
      const cpx = curIntersection ? mx : mx + (originScreenX - mx) * 0.14;
      const cpy = curIntersection ? my : my + (originScreenY - my) * 0.14;

      ctx.beginPath();
      ctx.moveTo(pA.x, pA.y);
      ctx.quadraticCurveTo(cpx, cpy, pB.x, pB.y);
      ctx.strokeStyle = rgba(edgeColor, edgeAlpha);
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    // 5. Draw nodes
    const labelCandidates: Array<{
      node: AtlasGraphNode;
      sx: number;
      sy: number;
      sr: number;
      pos: AtlasNodePosition;
      alpha: number;
      priority: number;
    }> = [];
    const nodeCircleBoxes: Array<{ id: string; box: LabelBox }> = [];

    for (const node of curGraph.nodes) {
      if (!visibleIds.has(node.id)) continue;
      const pos = renderPosRef.current.get(node.id);
      if (!pos) continue;

      const screen = toScreen(pos.x, pos.y);
      const sr = Math.max(3.5, pos.radius * cam.zoom);

      if (
        screen.x < -sr - 260 ||
        screen.x > width + sr + 260 ||
        screen.y < -sr - 120 ||
        screen.y > height + sr + 120
      ) {
        continue;
      }

      const alpha = getNodeAlpha(node);
      const isSelected = node.id === curSelectedNodeId;
      const isCompare = node.id === curCompareNodeId;
      const isHovered = node.id === curHoveredNodeId;
      const isShared = Boolean(curIntersection?.sharedNodeIds.has(node.id));
      const isOnlyA = Boolean(curIntersection?.onlyAIds.has(node.id));
      const isOnlyB = Boolean(curIntersection?.onlyBIds.has(node.id));
      const isDirectNeighbor = Boolean(focusAdj?.has(node.id));
      const isCourseGroup =
        curCourseFilter !== null &&
        !curIntersection &&
        !focusId &&
        node.kind === "group" &&
        node.course === curCourseFilter;

      const baseColor =
        isCompare || isOnlyB
          ? palette.compareB
          : isOnlyA || (curIntersection && node.id === curIntersection.nodeAId)
            ? palette.accent
            : isShared
              ? palette.sharedGold
              : palette.kinds[node.kind];

      if (isSelected || isCompare || isHovered || isShared || isCourseGroup) {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, sr + (isSelected || isCompare ? 7 : 5), 0, Math.PI * 2);
        ctx.fillStyle = rgba(
          baseColor,
          isSelected || isCompare ? 0.22 : isCourseGroup ? 0.18 : 0.16,
        );
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(screen.x, screen.y, sr, 0, Math.PI * 2);
      if (isSelected || isCompare || isShared || isDirectNeighbor || isCourseGroup) {
        ctx.fillStyle = rgba(baseColor, alpha);
      } else {
        ctx.fillStyle = rgba(palette.card, Math.max(0.75, alpha));
      }
      ctx.fill();

      ctx.lineWidth = isSelected || isCompare || isHovered ? 2.4 : isOnlyA || isOnlyB ? 2 : 1.75;
      ctx.strokeStyle = rgba(baseColor, Math.min(1, alpha + 0.12));
      ctx.stroke();

      if (!isSelected && !isCompare && !isShared && !isDirectNeighbor && !isCourseGroup && sr >= 5.5) {
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, Math.max(2, sr * 0.42), 0, Math.PI * 2);
        ctx.fillStyle = rgba(baseColor, alpha * 0.92);
        ctx.fill();
      }

      let priority = node.lessonsCount;
      if (node.kind === "group") priority += 40;
      if (isDirectNeighbor) priority += 450;
      if (isCourseGroup) priority += 550;
      if (isOnlyA || isOnlyB) priority += 600;
      if (isShared) priority += 700;
      if (isCompare) priority += 900;
      if (isSelected || isHovered) priority += 1000;

      if (alpha >= 0.34 || isSelected || isCompare || isHovered || isCourseGroup) {
        labelCandidates.push({ node, sx: screen.x, sy: screen.y, sr, pos, alpha, priority });
        nodeCircleBoxes.push({
          id: node.id,
          box: {
            x1: screen.x - sr - 3,
            y1: screen.y - sr - 3,
            x2: screen.x + sr + 3,
            y2: screen.y + sr + 3,
          },
        });
      }
    }

    // 6. Zero-overlap LOD label pass
    labelCandidates.sort((a, b) => b.priority - a.priority);
    const placedBoxes: LabelBox[] = [];
    const isEgoView = curLayoutMode === "ego" && !curIntersection && Boolean(curSelectedNodeId);
    const useFullLabel = cam.zoom >= 0.7 || isEgoView || Boolean(curIntersection);

    ctx.textBaseline = "middle";

    // Draw compact column zone headers in Compare mode above populated wings/center
    if (curIntersection && cam.zoom >= 0.25) {
      const nodeALabel = curGraph.nodeMap.get(curIntersection.nodeAId)?.label ?? "A";
      const nodeBLabel = curGraph.nodeMap.get(curIntersection.nodeBId)?.label ?? "B";
      const sharedAll = [
        ...curIntersection.sharedByKind.teachers,
        ...curIntersection.sharedByKind.groups,
      ];

      const drawZoneHeader = (
        text: string,
        sx: number,
        sy: number,
        tint: Rgb,
      ) => {
        ctx.font = "700 10px var(--font-manrope), system-ui, sans-serif";
        const tw = ctx.measureText(text).width + 18;
        const th = 20;
        const box: LabelBox = {
          x1: sx - tw * 0.5,
          y1: sy - th * 0.5,
          x2: sx + tw * 0.5,
          y2: sy + th * 0.5,
        };
        placedBoxes.push(box);
        drawRoundedRectPath(ctx, box.x1, box.y1, tw, th, 10);
        ctx.fillStyle = rgba(palette.card, palette.isDark ? 0.92 : 0.96);
        ctx.fill();
        ctx.strokeStyle = rgba(tint, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = rgba(tint, palette.isDark ? 0.95 : 0.92);
        ctx.fillText(text, sx, sy + 0.5);
      };

      const onlyAVisible = curIntersection.onlyARows
        .slice(0, 8)
        .map((r) => renderPosRef.current.get(r.node.id))
        .filter((p): p is AtlasNodePosition => Boolean(p));
      if (onlyAVisible.length > 0) {
        const minY = Math.min(...onlyAVisible.map((p) => p.y));
        const top = toScreen(onlyAVisible[0].x, minY);
        drawZoneHeader(
          `ТІЛЬКИ У ${nodeALabel} (${curIntersection.onlyARows.length})`,
          top.x,
          top.y - 44,
          palette.accent,
        );
      }

      const sharedVisible = sharedAll
        .map((n) => renderPosRef.current.get(n.id))
        .filter((p): p is AtlasNodePosition => Boolean(p));
      if (sharedVisible.length > 0) {
        const minY = Math.min(...sharedVisible.map((p) => p.y));
        const top = toScreen(0, minY);
        drawZoneHeader(`СПІЛЬНІ (${sharedAll.length})`, top.x, top.y - 46, palette.sharedGold);
      }

      const onlyBVisible = curIntersection.onlyBRows
        .slice(0, 8)
        .map((r) => renderPosRef.current.get(r.node.id))
        .filter((p): p is AtlasNodePosition => Boolean(p));
      if (onlyBVisible.length > 0) {
        const minY = Math.min(...onlyBVisible.map((p) => p.y));
        const top = toScreen(onlyBVisible[0].x, minY);
        drawZoneHeader(
          `ТІЛЬКИ У ${nodeBLabel} (${curIntersection.onlyBRows.length})`,
          top.x,
          top.y - 44,
          palette.compareB,
        );
      }
    }

    for (const item of labelCandidates) {
      const isCenterInEgo = isEgoView && item.node.id === curSelectedNodeId;
      const isOrbitNeighbor = isEgoView && item.node.id !== curSelectedNodeId;
      const isOnlyANode = Boolean(curIntersection?.onlyAIds.has(item.node.id));
      const isOnlyBNode = Boolean(curIntersection?.onlyBIds.has(item.node.id));
      const isSharedNode = Boolean(curIntersection?.sharedNodeIds.has(item.node.id));
      const isCompareDiffNode = isOnlyANode || isOnlyBNode;
      const isCompareAnchorNode = Boolean(
        curIntersection &&
          (item.node.id === curIntersection.nodeAId || item.node.id === curIntersection.nodeBId),
      );
      const isCourseTargetGroup = Boolean(
        curCourseFilter !== null &&
          !curIntersection &&
          curLayoutMode === "constellation" &&
          !focusId &&
          item.node.kind === "group" &&
          item.node.course === curCourseFilter,
      );
      const isForceShown =
        isEgoView ||
        item.node.id === curSelectedNodeId ||
        item.node.id === curCompareNodeId ||
        item.node.id === curHoveredNodeId ||
        isSharedNode ||
        isCompareDiffNode ||
        isCourseTargetGroup;

      if (!isForceShown && cam.zoom < 0.34 && !hasHighlightContext && item.node.kind !== "group") {
        continue;
      }

      const text =
        isForceShown || useFullLabel
          ? item.node.label
          : item.node.shortLabel;
      const subtitleText =
        !isCompareAnchorNode &&
        (isOrbitNeighbor || Boolean(curIntersection)) &&
        item.pos.subtitle
          ? item.pos.subtitle
          : null;
      const singleLineSub = Boolean(curIntersection) || width < 520;
      const maxSubChars = width < 480 ? 24 : curIntersection ? 28 : 34;
      const subLines = subtitleText
        ? wrapSubtitleText(subtitleText, maxSubChars, singleLineSub)
        : [];

      const fontSize = isCenterInEgo ? 13 : isForceShown ? 11.5 : item.node.kind === "group" ? 11.5 : 10.5;
      const fontWeight = isForceShown || item.node.kind === "group" ? "700" : "600";
      const font = `${fontWeight} ${fontSize}px var(--font-manrope), system-ui, sans-serif`;
      ctx.font = font;

      const cacheKey = `${fontWeight}:${fontSize}:${text}`;
      let textW = labelWidthCacheRef.current.get(cacheKey);
      if (textW === undefined) {
        textW = ctx.measureText(text).width;
        labelWidthCacheRef.current.set(cacheKey, textW);
      }

      let subW = 0;
      const subFont = "500 10px var(--font-manrope), system-ui, sans-serif";
      if (subLines.length > 0) {
        ctx.font = subFont;
        for (const subLine of subLines) {
          const subCacheKey = `500:10:${subLine}`;
          let lineW = labelWidthCacheRef.current.get(subCacheKey);
          if (lineW === undefined) {
            lineW = ctx.measureText(subLine).width;
            labelWidthCacheRef.current.set(subCacheKey, lineW);
          }
          if (lineW > subW) subW = lineW;
        }
        ctx.font = font;
      }

      const padX = isForceShown ? 9 : 5;
      const pillW = Math.max(textW, subW) + padX * 2;
      const pillH =
        subLines.length === 0
          ? isForceShown
            ? 22
            : 18
          : subLines.length === 1
            ? 34
            : 20 + subLines.length * 14;

      // Place radially outward in polar coordinates, or directly outward/above/below in compare/center nodes
      const radialDist = Math.hypot(item.pos.x, item.pos.y);
      let cx = item.sx;
      let cy = item.sy + item.sr + pillH * 0.5 + 5;
      let align: CanvasTextAlign = "center";

      if (radialDist > 40 && !curIntersection) {
        const cos = item.pos.x / radialDist;
        const sin = item.pos.y / radialDist;
        const sideThreshold = width >= 440 ? 0.15 : 0.42;
        if (Math.abs(cos) > sideThreshold) {
          const offset = item.sr + 7;
          if (cos >= 0) {
            align = "left";
            cx = item.sx + offset + pillW * 0.5;
          } else {
            align = "right";
            cx = item.sx - offset - pillW * 0.5;
          }
          cy = item.sy + sin * 5;
        } else {
          align = "center";
          cx = item.sx;
          cy = sin >= 0
            ? item.sy + item.sr + pillH * 0.5 + 5
            : item.sy - item.sr - pillH * 0.5 - 5;
        }
      } else if (curIntersection) {
        if (item.node.id === curIntersection.nodeAId || item.node.id === curIntersection.nodeBId) {
          cy = item.sy - item.sr - pillH * 0.5 - 8;
        } else if (isSharedNode) {
          cx = item.sx;
          cy = item.sy + item.sr + pillH * 0.5 + 5;
        } else if (isOnlyANode) {
          if (width >= 480) {
            cx = item.sx - item.sr - 8 - pillW * 0.5;
            cy = item.sy;
          } else {
            cx = item.sx;
            cy = item.sy + item.sr + pillH * 0.5 + 5;
          }
        } else if (isOnlyBNode) {
          if (width >= 480) {
            cx = item.sx + item.sr + 8 + pillW * 0.5;
            cy = item.sy;
          } else {
            cx = item.sx;
            cy = item.sy + item.sr + pillH * 0.5 + 5;
          }
        }
      }

      let box: LabelBox = {
        x1: cx - pillW * 0.5,
        y1: cy - pillH * 0.5,
        x2: cx + pillW * 0.5,
        y2: cy + pillH * 0.5,
      };

      // Reserve small role badge box above center node in orbit mode
      if (isCenterInEgo) {
        const roleText = item.node.kind === "group" ? "ГРУПА" : "ВИКЛАДАЧ";
        const roleFont = "700 9.5px var(--font-manrope), system-ui, sans-serif";
        ctx.font = roleFont;
        const roleW = ctx.measureText(roleText).width + 14;
        const roleH = 16;
        const roleCx = item.sx;
        const roleCy = item.sy - item.sr - roleH * 0.5 - 5;
        const roleBox: LabelBox = {
          x1: roleCx - roleW * 0.5,
          y1: roleCy - roleH * 0.5,
          x2: roleCx + roleW * 0.5,
          y2: roleCy + roleH * 0.5,
        };
        placedBoxes.push(roleBox);
        drawRoundedRectPath(ctx, roleBox.x1, roleBox.y1, roleW, roleH, 8);
        ctx.fillStyle = rgba(palette.card, 0.94);
        ctx.fill();
        ctx.strokeStyle = rgba(palette.kinds[item.node.kind], 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.fillStyle = rgba(palette.kinds[item.node.kind], 0.98);
        ctx.fillText(roleText, roleCx, roleCy + 0.5);
        ctx.font = font;
      }

      const hasCollision = (candidate: LabelBox): boolean => {
        for (let i = 0; i < placedBoxes.length; i++) {
          if (boxesOverlap(candidate, placedBoxes[i], 3)) return true;
        }
        for (let i = 0; i < nodeCircleBoxes.length; i++) {
          if (nodeCircleBoxes[i].id === item.node.id) continue;
          if (boxesOverlap(candidate, nodeCircleBoxes[i].box, 2)) return true;
        }
        return false;
      };

      if (!isForceShown) {
        if (hasCollision(box)) continue;
      } else if ((isOrbitNeighbor || Boolean(curIntersection) || isCourseTargetGroup) && hasCollision(box)) {
        // Test candidate placements (vertical nudges, above/below node, opposite side) so force-shown labels never stack
        const candidateCenters: Array<{ cx: number; cy: number }> = [];
        for (const dy of [-14, 14, -28, 28, -42, 42, -58, 58]) {
          candidateCenters.push({ cx, cy: cy + dy });
        }
        const sideOffset = item.sr + 7 + pillW * 0.5;
        const vertOffset = item.sr + 5 + pillH * 0.5;
        candidateCenters.push(
          { cx: item.sx, cy: item.sy - vertOffset },
          { cx: item.sx, cy: item.sy + vertOffset },
          { cx: item.sx + sideOffset, cy: item.sy },
          { cx: item.sx - sideOffset, cy: item.sy },
          { cx: item.sx + sideOffset, cy: item.sy - 18 },
          { cx: item.sx - sideOffset, cy: item.sy - 18 },
          { cx: item.sx + sideOffset, cy: item.sy + 18 },
          { cx: item.sx - sideOffset, cy: item.sy + 18 },
        );

        for (const cand of candidateCenters) {
          const nudged: LabelBox = {
            x1: cand.cx - pillW * 0.5,
            y1: cand.cy - pillH * 0.5,
            x2: cand.cx + pillW * 0.5,
            y2: cand.cy + pillH * 0.5,
          };
          if (!hasCollision(nudged)) {
            cx = cand.cx;
            cy = cand.cy;
            box = nudged;
            break;
          }
        }
      }
      placedBoxes.push(box);

      // Draw crisp label pill background for maximum readability
      const isAccentPill = item.node.id === curSelectedNodeId || item.node.id === curCompareNodeId;
      const pillColor =
        item.node.id === curCompareNodeId || isOnlyBNode
          ? palette.compareB
          : isOnlyANode || (curIntersection && item.node.id === curIntersection.nodeAId)
            ? palette.accent
            : isSharedNode
              ? palette.sharedGold
              : palette.kinds[item.node.kind];

      drawRoundedRectPath(ctx, box.x1, box.y1, pillW, pillH, subLines.length > 0 ? 9 : 7);
      if (isAccentPill) {
        ctx.fillStyle = rgba(pillColor, 0.96);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
      } else {
        ctx.fillStyle = rgba(palette.card, palette.isDark ? 0.92 : 0.96);
        ctx.fill();
        ctx.strokeStyle = rgba(
          isForceShown ? pillColor : palette.border,
          isForceShown ? 0.62 : 0.7,
        );
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = rgba(palette.textPrimary, Math.min(1, item.alpha + 0.12));
      }

      ctx.textAlign = "center";
      if (subLines.length === 1) {
        ctx.font = font;
        ctx.fillText(text, cx, cy - 6.5);
        ctx.font = subFont;
        ctx.fillStyle = isAccentPill
          ? "rgba(255, 255, 255, 0.92)"
          : subtitleText?.startsWith("Куратор")
            ? rgba(palette.sharedGold, palette.isDark ? 0.95 : 0.92)
            : rgba(palette.textSecondary, Math.min(1, item.alpha));
        ctx.fillText(subLines[0], cx, cy + 7.5);
      } else if (subLines.length >= 2) {
        ctx.font = font;
        ctx.fillText(text, cx, box.y1 + 12);
        ctx.font = subFont;
        ctx.fillStyle = isAccentPill
          ? "rgba(255, 255, 255, 0.92)"
          : subtitleText?.startsWith("Куратор")
            ? rgba(palette.sharedGold, palette.isDark ? 0.95 : 0.92)
            : rgba(palette.textSecondary, Math.min(1, item.alpha));
        subLines.forEach((line, idx) => {
          ctx.fillText(line, cx, box.y1 + 26 + idx * 13.5);
        });
      } else {
        ctx.font = font;
        ctx.fillText(text, cx, cy + 0.5);
      }
      void align;
    }

    ctx.restore();
    return needsNextFrame;
  }, []);

  const scheduleDraw = useCallback(() => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = window.requestAnimationFrame(function frame(now: number) {
      rafIdRef.current = null;
      const needsNextFrame = drawCanvasFrame(now);
      if (needsNextFrame) {
        rafIdRef.current = window.requestAnimationFrame(frame);
      }
    });
  }, [drawCanvasFrame]);

  const flyToCamera = useCallback(
    (targetX: number, targetY: number, targetZoom: number, duration = 360) => {
      const clampedZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
      if (shouldReduceMotion || duration <= 0) {
        cameraTweenRef.current = null;
        cameraRef.current = { x: targetX, y: targetY, zoom: clampedZoom };
        scheduleDraw();
        return;
      }
      cameraTweenRef.current = {
        startX: cameraRef.current.x,
        startY: cameraRef.current.y,
        startZoom: cameraRef.current.zoom,
        targetX,
        targetY,
        targetZoom: clampedZoom,
        startTime: performance.now(),
        duration,
      };
      scheduleDraw();
    },
    [scheduleDraw, shouldReduceMotion],
  );

  // Sync theme & live Appearance Studio CSS variables into Canvas palette
  useEffect(() => {
    const syncPalette = () => {
      paletteRef.current = readPaletteFromDom(resolvedTheme);
      scheduleDraw();
    };
    syncPalette();
    const observer = new MutationObserver(syncPalette);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-accent", "style"],
    });
    return () => observer.disconnect();
  }, [resolvedTheme, scheduleDraw]);

  // Keep canvas sized cleanly to container with DPR capped at 2
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const width = Math.max(200, Math.round(rect.width));
      const height = Math.max(260, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const prevSize = sizeRef.current;
      const sizeChangedSignificantly =
        initializedFitRef.current &&
        (Math.abs(prevSize.width - width) > 24 || Math.abs(prevSize.height - height) > 24);
      sizeRef.current = { width, height, dpr };
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      if ((!initializedFitRef.current || sizeChangedSignificantly) && activeLayout.visibleNodeIds.size > 0) {
        initializedFitRef.current = true;
        const fit = computeFitTransform(activeLayout.bounds);
        cameraRef.current = fit;
      }
      if (renderPosRef.current.size === 0 && activeLayout.positions.size > 0) {
        renderPosRef.current = new Map(activeLayout.positions);
      }
      const needsNext = drawCanvasFrame(performance.now());
      if (needsNext) scheduleDraw();
    };

    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(container);
    return () => ro.disconnect();
  }, [activeLayout.bounds, activeLayout.positions, activeLayout.visibleNodeIds.size, computeFitTransform, drawCanvasFrame, scheduleDraw]);

  // Morph node positions when layout changes (constellation <-> ego <-> compare)
  const prevLayoutModeRef = useRef(layoutMode);
  const prevHadIntersectionRef = useRef(Boolean(intersection));
  useEffect(() => {
    const prevMap = renderPosRef.current;
    if (prevMap.size === 0 || shouldReduceMotion) {
      renderPosRef.current = new Map(activeLayout.positions);
      posTweenRef.current = null;
    } else {
      const fromSnapshot = new Map<string, AtlasNodePosition>();
      for (const [id, toPos] of Array.from(activeLayout.positions.entries())) {
        fromSnapshot.set(id, prevMap.get(id) ?? toPos);
      }
      posTweenRef.current = {
        from: fromSnapshot,
        to: activeLayout.positions,
        startTime: performance.now(),
        duration: 340,
      };
    }

    const modeOrCompareChanged =
      prevLayoutModeRef.current !== layoutMode ||
      prevHadIntersectionRef.current !== Boolean(intersection);
    prevLayoutModeRef.current = layoutMode;
    prevHadIntersectionRef.current = Boolean(intersection);

    if (intersection || layoutMode === "ego" || modeOrCompareChanged) {
      const fit = computeFitTransform(activeLayout.bounds);
      flyToCamera(fit.x, fit.y, fit.zoom, 380);
    } else {
      scheduleDraw();
    }
  }, [activeLayout, computeFitTransform, flyToCamera, intersection, layoutMode, scheduleDraw, shouldReduceMotion]);

  // Center gently when user explicitly picks a node in constellation mode
  const prevSelectedRef = useRef<string | null>(null);
  const initialSelectedHandledRef = useRef(false);
  useEffect(() => {
    if (layoutMode !== "constellation" || intersection) {
      prevSelectedRef.current = selectedNodeId;
      return;
    }
    if (!initialSelectedHandledRef.current && selectedNodeId) {
      initialSelectedHandledRef.current = true;
      prevSelectedRef.current = selectedNodeId;
      return;
    }
    if (selectedNodeId && selectedNodeId !== prevSelectedRef.current) {
      const pos = activeLayout.positions.get(selectedNodeId);
      if (pos) {
        const targetZoom = Math.max(cameraRef.current.zoom, sizeRef.current.width < 640 ? 0.56 : 0.78);
        flyToCamera(pos.x, pos.y, targetZoom, 380);
      }
    }
    prevSelectedRef.current = selectedNodeId;
  }, [activeLayout.positions, flyToCamera, intersection, layoutMode, selectedNodeId]);

  // Schedule redraw when hover state changes, and frame selected course sector smoothly
  const prevCourseFilterRef = useRef<number | null>(null);
  useEffect(() => {
    const courseChanged = prevCourseFilterRef.current !== courseFilter;
    prevCourseFilterRef.current = courseFilter;

    if (courseChanged && layoutMode === "constellation" && !intersection && !selectedNodeId) {
      if (courseFilter !== null && courseBounds) {
        const fit = computeFitTransform(courseBounds);
        flyToCamera(fit.x, fit.y, fit.zoom, 380);
        return;
      }
      if (courseFilter === null) {
        const fit = computeFitTransform(activeLayout.bounds);
        flyToCamera(fit.x, fit.y, fit.zoom, 380);
        return;
      }
    }
    scheduleDraw();
  }, [
    activeLayout.bounds,
    computeFitTransform,
    courseBounds,
    courseFilter,
    flyToCamera,
    hoveredNodeId,
    intersection,
    layoutMode,
    scheduleDraw,
    selectedNodeId,
  ]);

  // Cleanup rAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  // Non-passive wheel zoom anchored at cursor coordinates
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cameraTweenRef.current = null;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const { width, height } = sizeRef.current;
      const cam = cameraRef.current;

      const worldX = (sx - width / 2) / cam.zoom + cam.x;
      const worldY = (sy - height / 2) / cam.zoom + cam.y;

      const factor = Math.exp(-e.deltaY * 0.0014);
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cam.zoom * factor));

      cam.zoom = nextZoom;
      cam.x = worldX - (sx - width / 2) / nextZoom;
      cam.y = worldY - (sy - height / 2) / nextZoom;
      scheduleDraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [scheduleDraw]);

  const hitTestNode = useCallback(
    (clientX: number, clientY: number, isTouch: boolean): AtlasGraphNode | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const sx = clientX - rect.left;
      const sy = clientY - rect.top;
      const { width, height } = sizeRef.current;
      const cam = cameraRef.current;
      const pad = isTouch ? 12 : 6;

      let best: AtlasGraphNode | null = null;
      let bestScore = Infinity;

      for (const node of graph.nodes) {
        if (!activeLayout.visibleNodeIds.has(node.id)) continue;
        const pos = renderPosRef.current.get(node.id);
        if (!pos) continue;

        const nx = (pos.x - cam.x) * cam.zoom + width / 2;
        const ny = (pos.y - cam.y) * cam.zoom + height / 2;
        const hitR = Math.max(isTouch ? 20 : 12, pos.radius * cam.zoom + pad);
        const dist = Math.hypot(sx - nx, sy - ny);

        if (dist <= hitR) {
          // Prioritize selected or directly connected nodes slightly when overlapping closely
          const priorityOffset = node.id === selectedNodeId ? -8 : 0;
          const score = dist + priorityOffset;
          if (score < bestScore) {
            bestScore = score;
            best = node;
          }
        }
      }
      return best;
    },
    [activeLayout.visibleNodeIds, graph.nodes, selectedNodeId],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    cameraTweenRef.current = null;

    if (pointersRef.current.size === 1) {
      dragStateRef.current = {
        ...dragStateRef.current,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
      pinchStateRef.current = null;
    } else if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const rect = canvas.getBoundingClientRect();
      const midScreenX = (pts[0].x + pts[1].x) * 0.5 - rect.left;
      const midScreenY = (pts[0].y + pts[1].y) * 0.5 - rect.top;
      const { width, height } = sizeRef.current;
      const cam = cameraRef.current;
      pinchStateRef.current = {
        initialDist: Math.max(10, dist),
        initialZoom: cam.zoom,
        worldMidX: (midScreenX - width / 2) / cam.zoom + cam.x,
        worldMidY: (midScreenY - height / 2) / cam.zoom + cam.y,
      };
      dragStateRef.current.moved = true;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointersRef.current.size === 2 && pinchStateRef.current) {
        const pts = Array.from(pointersRef.current.values());
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        const rect = canvas.getBoundingClientRect();
        const midScreenX = (pts[0].x + pts[1].x) * 0.5 - rect.left;
        const midScreenY = (pts[0].y + pts[1].y) * 0.5 - rect.top;
        const { width, height } = sizeRef.current;

        const nextZoom = Math.max(
          MIN_ZOOM,
          Math.min(MAX_ZOOM, pinchStateRef.current.initialZoom * (dist / pinchStateRef.current.initialDist)),
        );
        cameraRef.current.zoom = nextZoom;
        cameraRef.current.x = pinchStateRef.current.worldMidX - (midScreenX - width / 2) / nextZoom;
        cameraRef.current.y = pinchStateRef.current.worldMidY - (midScreenY - height / 2) / nextZoom;
        scheduleDraw();
        return;
      }

      if (pointersRef.current.size === 1 && dragStateRef.current.pointerId === e.pointerId) {
        const totalDist = Math.hypot(
          e.clientX - dragStateRef.current.startX,
          e.clientY - dragStateRef.current.startY,
        );
        if (totalDist > 4) {
          dragStateRef.current.moved = true;
        }
        const dx = e.clientX - dragStateRef.current.lastX;
        const dy = e.clientY - dragStateRef.current.lastY;
        dragStateRef.current.lastX = e.clientX;
        dragStateRef.current.lastY = e.clientY;
        if (dragStateRef.current.moved) {
          cameraRef.current.x -= dx / cameraRef.current.zoom;
          cameraRef.current.y -= dy / cameraRef.current.zoom;
          scheduleDraw();
        }
        return;
      }
    }

    // Desktop hover hit-testing
    if (e.pointerType === "mouse" && pointersRef.current.size === 0) {
      const hit = hitTestNode(e.clientX, e.clientY, false);
      const nextHover = hit ? hit.id : null;
      if (nextHover !== hoveredNodeId) {
        setHoveredNodeId(nextHover);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        if (canvas.hasPointerCapture(e.pointerId)) {
          canvas.releasePointerCapture(e.pointerId);
        }
      } catch {}
    }

    const wasDrag = dragStateRef.current.moved;
    const isSingleRelease = pointersRef.current.size === 1;
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }

    if (isSingleRelease && !wasDrag) {
      const hit = hitTestNode(e.clientX, e.clientY, e.pointerType !== "mouse");
      if (hit) {
        const now = performance.now();
        const isDoubleClick =
          dragStateRef.current.lastTapNodeId === hit.id &&
          now - dragStateRef.current.lastTapTime < 340;
        dragStateRef.current.lastTapTime = now;
        dragStateRef.current.lastTapNodeId = hit.id;

        onSelectNode(hit.id);
        if (!intersection && layoutMode === "constellation") {
          onLayoutModeChange("ego");
        } else if (isDoubleClick && !intersection) {
          onLayoutModeChange(layoutMode === "ego" ? "constellation" : "ego");
        }
      } else if (layoutMode === "constellation" && !intersection) {
        onSelectNode(null);
      }
    }
  };

  const handleFitView = () => {
    const targetBounds =
      courseFilter !== null && courseBounds && layoutMode === "constellation" && !intersection
        ? courseBounds
        : activeLayout.bounds;
    const fit = computeFitTransform(targetBounds);
    flyToCamera(fit.x, fit.y, fit.zoom, 360);
  };

  const handleZoomBy = (factor: number) => {
    flyToCamera(cameraRef.current.x, cameraRef.current.y, cameraRef.current.zoom * factor, 200);
  };

  const isEgoActive = layoutMode === "ego" && !intersection && Boolean(selectedNodeId);

  return (
    <div
      ref={containerRef}
      className={`relative w-full rounded-2xl border border-sys-border bg-sys-card overflow-hidden select-none shadow-xs ${
        mobileHeightMode === "expanded"
          ? "h-[420px] sm:h-[520px] lg:h-[660px]"
          : "h-[290px] sm:h-[360px] lg:h-[660px]"
      }`}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={() => setHoveredNodeId(null)}
        aria-label="Інтерактивна мапа зв'язків ДФКР"
        className={`block w-full h-full touch-none ${
          hoveredNodeId ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
        }`}
      />

      {/* Top-Left Mode Switcher */}
      {!intersection && (
        <div className="absolute top-2.5 left-2.5 sm:top-3 sm:left-3 z-10 flex items-center gap-0.5 sm:gap-1 rounded-xl border border-sys-border bg-sys-card/95 p-0.5 sm:p-1 shadow-sm">
          <button
            type="button"
            disabled={!selectedNodeId}
            onClick={() => onLayoutModeChange("ego")}
            title={selectedNodeId ? "Поставити обраний вузол у центр" : "Оберіть вузол на мапі"}
            className={`px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-xs rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap disabled:opacity-45 disabled:cursor-not-allowed ${
              isEgoActive
                ? "bg-sys-accent text-white shadow-xs"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Орбіта
          </button>
          <button
            type="button"
            onClick={() => onLayoutModeChange("constellation")}
            className={`px-2 py-1 text-[11px] sm:px-2.5 sm:py-1.5 sm:text-xs rounded-lg font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              !isEgoActive
                ? "bg-sys-accent text-white shadow-xs"
                : "text-sys-text-secondary hover:text-sys-text-primary"
            }`}
          >
            Весь коледж
          </button>
        </div>
      )}

      {/* Top-Right Camera Controls */}
      <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-10 flex items-center gap-1.5">
        <div className="flex items-center rounded-xl border border-sys-border bg-sys-card/95 p-0.5 shadow-sm">
          <button
            type="button"
            onClick={() => handleZoomBy(1.28)}
            aria-label="Наблизити мапу"
            title="Наблизити"
            className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-sm font-bold text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors cursor-pointer"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handleZoomBy(0.78)}
            aria-label="Віддалити мапу"
            title="Віддалити"
            className="flex h-7 w-7 sm:h-8 sm:w-8 items-center justify-center rounded-lg text-sm font-bold text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors cursor-pointer"
          >
            −
          </button>
          <div className="w-px h-4 bg-sys-border mx-0.5" />
          <button
            type="button"
            onClick={handleFitView}
            aria-label="Вписати всю мапу в екран"
            title="Вписати все"
            className="px-2 h-7 text-[11px] sm:px-2.5 sm:h-8 sm:text-xs rounded-lg font-semibold text-sys-text-secondary hover:bg-sys-bg hover:text-sys-text-primary transition-colors cursor-pointer whitespace-nowrap"
          >
            Вписати
          </button>
        </div>
      </div>

      {/* Bottom Legend Bar */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-center justify-between gap-2">
        {intersection ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-sys-border bg-sys-card/95 px-3 py-1.5 text-[11px] font-medium text-sys-text-secondary shadow-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sys-accent shrink-0" />
              <span>{graph.nodeMap.get(intersection.nodeAId)?.label ?? "A"}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
              <span>Спільні</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 shrink-0" />
              <span>{graph.nodeMap.get(intersection.nodeBId)?.label ?? "B"}</span>
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-sys-border bg-sys-card/95 px-3 py-1.5 text-[11px] font-medium text-sys-text-secondary shadow-xs">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-sys-accent shrink-0" />
              <span>Групи</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
              <span>Викладачі</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shrink-0" />
              <span>Куратор</span>
            </span>
          </div>
        )}

        <div className="hidden sm:flex items-center rounded-xl border border-sys-border bg-sys-card/95 px-3 py-1.5 text-[11px] text-sys-text-muted shadow-xs">
          <span>
            {intersection
              ? "Клік по вузлу — перейти у його орбіту · Колесо для зуму"
              : "Клік по сусіду — перехід у його орбіту · Колесо для зуму"}
          </span>
        </div>
      </div>
    </div>
  );
}
