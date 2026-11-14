import type {
  AtlasEdge,
  AtlasGroupNode,
  AtlasResponse,
  AtlasRoomNode,
  AtlasSubjectNode,
  AtlasTeacherNode,
} from "../api/types";

export type AtlasNodeKind = "group" | "teacher" | "subject" | "room";

export type AtlasLinkKind =
  | "teaches"
  | "curator"
  | "studies"
  | "subject-teacher"
  | "uses-room";

export interface AtlasGraphNode {
  id: string;
  rawId: number | string;
  kind: AtlasNodeKind;
  label: string;
  shortLabel: string;
  subtitle: string | null;
  course: number | null;
  floor: number | null;
  curatorId: number | null;
  facultyName: string | null;
  fullName: string | null;
  homeRoom: string | null;
  lessonsCount: number;
  degree: number;
  isConnected: boolean;
  x: number;
  y: number;
  radius: number;
  angle: number;
  ringIndex: 0 | 1 | 2 | 3;
}

export interface AtlasGraphLink {
  id: string;
  source: string;
  target: string;
  kind: AtlasLinkKind;
  weight: number;
  days: number[];
  /** Primary ring edges connect adjacent rings so overview avoids spaghetti cross-chords. */
  isPrimaryRingEdge: boolean;
}

export interface AtlasRingMeta {
  radius: number;
  kind: AtlasNodeKind;
  label: string;
  count: number;
}

export interface AtlasGraph {
  nodes: AtlasGraphNode[];
  nodeMap: Map<string, AtlasGraphNode>;
  links: AtlasGraphLink[];
  adjacency: Map<string, Set<string>>;
  rings: AtlasRingMeta[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  groupsRaw: Map<number, AtlasGroupNode>;
  teachersRaw: Map<number, AtlasTeacherNode>;
  subjectsRaw: Map<number, AtlasSubjectNode>;
  roomsRaw: Map<string, AtlasRoomNode>;
  edgesRaw: AtlasEdge[];
}

export interface AtlasNodePosition {
  x: number;
  y: number;
  radius: number;
  angle: number;
  subtitle?: string | null;
}

export interface AtlasLayoutSnapshot {
  visibleNodeIds: Set<string>;
  positions: Map<string, AtlasNodePosition>;
  rings: Array<{ radius: number; label: string }>;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

export interface AtlasSharedSubjectSummary {
  id: number;
  label: string;
  lessonsCount: number;
}

export interface AtlasSharedRoomSummary {
  name: string;
  floor: number | null;
  lessonsCount: number;
}

export interface AtlasIntersectionResult {
  nodeAId: string;
  nodeBId: string;
  directConnected: boolean;
  sharedNodeIds: Set<string>;
  onlyAIds: Set<string>;
  onlyBIds: Set<string>;
  sharedByKind: {
    groups: AtlasGraphNode[];
    teachers: AtlasGraphNode[];
  };
  sharedSubjects: AtlasSharedSubjectSummary[];
  sharedRooms: AtlasSharedRoomSummary[];
  sharedRows: AtlasRelationRow[];
  onlyARows: AtlasRelationRow[];
  onlyBRows: AtlasRelationRow[];
}

export interface AtlasRelationRow {
  node: AtlasGraphNode;
  lessonsCount: number;
  days: number[];
  tags: string[];
  subjects: string[];
  rooms: string[];
  badge?: string | null;
}

export type AtlasRelationSortKey = "lessons" | "alpha" | "room" | "day" | "course";

export type AtlasCompareScope = "recommended" | "groups" | "teachers";

export interface AtlasCompareCandidate {
  node: AtlasGraphNode;
  sharedCount: number;
  reasonHint: string | null;
  score: number;
}

export interface AtlasNodeInspectorData {
  node: AtlasGraphNode;
  curatorTeacher: AtlasGraphNode | null;
  curatedGroups: AtlasGraphNode[];
  groups: AtlasRelationRow[];
  teachers: AtlasRelationRow[];
  subjects: AtlasRelationRow[];
  rooms: AtlasRelationRow[];
}

export function makeAtlasNodeId(kind: AtlasNodeKind, rawId: number | string): string {
  return `${kind}:${rawId}`;
}

export function compareAtlasLabels(a: string, b: string): number {
  return a.localeCompare(b, "uk", { numeric: true, sensitivity: "base" });
}

export function resolveTeacherEdgeRoom(
  graph: Pick<AtlasGraph, "teachersRaw">,
  edge: Pick<AtlasEdge, "teacher_id" | "second_teacher_id" | "room">,
  teacherId: number,
): string | null {
  const isPrimary = edge.teacher_id === teacherId;
  const isSecondary = edge.second_teacher_id === teacherId;
  if (!isPrimary && !isSecondary) return null;

  const teacherHome = graph.teachersRaw.get(teacherId)?.room?.trim() || null;
  const otherTeacherId = isPrimary ? edge.second_teacher_id : edge.teacher_id;
  const otherHome =
    otherTeacherId != null ? graph.teachersRaw.get(otherTeacherId)?.room?.trim() || null : null;

  const rawRoom = edge.room?.trim() || null;
  if (!rawRoom) {
    return teacherHome;
  }

  const parts = rawRoom
    .split(/\s*[\/,;]\s*/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    if (teacherHome) {
      const homeMatch = parts.find((part) => compareAtlasLabels(part, teacherHome) === 0);
      if (homeMatch) return homeMatch;
    }
    if (isSecondary) {
      return parts[1] ?? parts[0] ?? teacherHome;
    }
    return parts[0] ?? teacherHome;
  }

  // Backend stores edge.room as room_override ?? primary_teacher.room, so on a subgroup edge
  // the second teacher's own classroom should win over the primary teacher's room.
  if (edge.second_teacher_id != null && isSecondary) {
    if (
      teacherHome &&
      (!otherHome ||
        compareAtlasLabels(rawRoom, otherHome) === 0 ||
        compareAtlasLabels(rawRoom, teacherHome) !== 0)
    ) {
      return teacherHome;
    }
  }

  return rawRoom;
}

export function compactSubjectLabel(name: string, shortName: string | null): string {
  const cleanShort = shortName?.trim();
  if (cleanShort && cleanShort.length <= 18) return cleanShort;
  const trimmed = name.trim();
  if (trimmed.length <= 18) return trimmed;
  return `${trimmed.slice(0, 16).trimEnd()}…`;
}

function clampRadius(base: number, extra: number, maxExtra: number): number {
  return base + Math.min(maxExtra, extra);
}

function circularCentroid(
  ids: Iterable<string>,
  angleLookup: Map<string, number>,
  weightLookup?: Map<string, number>,
): number | null {
  let sx = 0;
  let sy = 0;
  let count = 0;
  for (const id of Array.from(ids)) {
    const a = angleLookup.get(id);
    if (a === undefined) continue;
    const w = weightLookup?.get(id) ?? 1;
    sx += Math.cos(a) * w;
    sy += Math.sin(a) * w;
    count++;
  }
  if (count === 0 || (Math.abs(sx) < 1e-6 && Math.abs(sy) < 1e-6)) return null;
  const angle = Math.atan2(sy, sx);
  return angle < 0 ? angle + Math.PI * 2 : angle;
}

function spreadRingByTargetAngle<T extends AtlasGraphNode>(
  nodes: T[],
  radius: number,
  desiredAngles: Map<string, number | null>,
  fallbackStartAngle = 0,
): void {
  if (nodes.length === 0) return;

  const indexed = nodes.map((n, i) => ({
    node: n,
    desired: desiredAngles.get(n.id),
    origIdx: i,
  }));

  indexed.sort((a, b) => {
    const aa = a.desired ?? (fallbackStartAngle + (a.origIdx / Math.max(1, nodes.length)) * Math.PI * 2);
    const bb = b.desired ?? (fallbackStartAngle + (b.origIdx / Math.max(1, nodes.length)) * Math.PI * 2);
    if (Math.abs(aa - bb) > 1e-4) return aa - bb;
    return compareAtlasLabels(a.node.label, b.node.label);
  });

  // Compute circular weighted offset so groups sit near their true centroid instead of arbitrary 0 rotation.
  let offset = fallbackStartAngle;
  const anchored = indexed.filter((item) => item.desired !== null);
  if (anchored.length > 0) {
    const firstDesired = anchored[0].desired as number;
    const firstIdx = indexed.indexOf(anchored[0]);
    offset = firstDesired - (firstIdx / indexed.length) * Math.PI * 2;
  }

  const step = (Math.PI * 2) / indexed.length;
  for (let i = 0; i < indexed.length; i++) {
    const theta = (offset + i * step + Math.PI * 4) % (Math.PI * 2);
    const n = indexed[i].node;
    n.angle = theta;
    n.x = Math.cos(theta) * radius;
    n.y = Math.sin(theta) * radius;
  }
}

function relaxOrbitCollisions(
  nodes: AtlasGraphNode[],
  ringTargets: Map<string, number>,
  iterations = 40,
): void {
  if (nodes.length <= 1) return;
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const minDist = a.radius + b.radius + 36;
        if (dist >= minDist) continue;

        if (dist < 0.001) {
          const angle = ((i * 1.618 + j * 0.754) % (Math.PI * 2));
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const push = (minDist - dist) * 0.42;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * push;
        a.y -= ny * push;
        b.x += nx * push;
        b.y += ny * push;
      }
    }

    // Pull gently back to target radial orbit so concentric structure stays crisp
    for (const n of nodes) {
      const targetR = ringTargets.get(n.id);
      if (!targetR) continue;
      const currR = Math.hypot(n.x, n.y);
      if (currR < 0.001) continue;
      const nextR = currR + (targetR - currR) * 0.38;
      const factor = nextR / currR;
      n.x *= factor;
      n.y *= factor;
      n.angle = Math.atan2(n.y, n.x);
    }
  }
}

function computeBoundsFromPositions(
  items: Iterable<{ x: number; y: number; radius: number }>,
  extraPad = 70,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let count = 0;

  for (const item of Array.from(items)) {
    count++;
    const pad = item.radius + extraPad;
    if (item.x - pad < minX) minX = item.x - pad;
    if (item.x + pad > maxX) maxX = item.x + pad;
    if (item.y - pad < minY) minY = item.y - pad;
    if (item.y + pad > maxY) maxY = item.y + pad;
  }

  if (count === 0) {
    return { minX: -400, maxX: 400, minY: -400, maxY: 400 };
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Builds a deterministic, collision-relaxed multi-ring constellation graph
 * connecting Groups, Teachers, Subjects, and Rooms from `/api/atlas`.
 */
export function buildAtlasGraph(data: AtlasResponse): AtlasGraph {
  const groupsRaw = new Map<number, AtlasGroupNode>();
  const teachersRaw = new Map<number, AtlasTeacherNode>();
  const subjectsRaw = new Map<number, AtlasSubjectNode>();
  const roomsRaw = new Map<string, AtlasRoomNode>();

  for (const g of data.groups) groupsRaw.set(g.id, g);
  for (const t of data.teachers) teachersRaw.set(t.id, t);
  for (const s of data.subjects) subjectsRaw.set(s.id, s);
  for (const r of data.rooms) roomsRaw.set(r.id, r);

  const nodeMap = new Map<string, AtlasGraphNode>();
  const linkAccum = new Map<
    string,
    {
      source: string;
      target: string;
      kind: AtlasLinkKind;
      weight: number;
      days: Set<number>;
      isPrimaryRingEdge: boolean;
    }
  >();
  const adjacency = new Map<string, Set<string>>();

  const ensureAdj = (id: string) => {
    let set = adjacency.get(id);
    if (!set) {
      set = new Set();
      adjacency.set(id, set);
    }
    return set;
  };

  for (const g of data.groups) {
    const id = makeAtlasNodeId("group", g.id);
    ensureAdj(id);
    nodeMap.set(id, {
      id,
      rawId: g.id,
      kind: "group",
      label: g.name,
      shortLabel: g.name,
      subtitle: g.course ? `${g.course} курс${g.faculty_name ? ` · ${g.faculty_name}` : ""}` : g.faculty_name,
      course: g.course,
      floor: null,
      curatorId: g.curator_id,
      facultyName: g.faculty_name,
      fullName: null,
      homeRoom: null,
      lessonsCount: g.lessons_count,
      degree: 0,
      isConnected: false,
      x: 0,
      y: 0,
      radius: clampRadius(14, g.lessons_count * 0.25, 6),
      angle: 0,
      ringIndex: 0,
    });
  }

  for (const t of data.teachers) {
    const id = makeAtlasNodeId("teacher", t.id);
    ensureAdj(id);
    nodeMap.set(id, {
      id,
      rawId: t.id,
      kind: "teacher",
      label: t.name,
      shortLabel: t.name,
      subtitle: t.room ? `ауд. ${t.room}` : t.full_name,
      course: null,
      floor: null,
      curatorId: null,
      facultyName: null,
      fullName: t.full_name,
      homeRoom: t.room,
      lessonsCount: t.lessons_count,
      degree: 0,
      isConnected: false,
      x: 0,
      y: 0,
      radius: clampRadius(12, Math.sqrt(t.lessons_count) * 1.4, 7),
      angle: 0,
      ringIndex: 1,
    });
  }

  const addLink = (
    a: string,
    b: string,
    kind: AtlasLinkKind,
    weight: number,
    days: number[],
    isPrimaryRingEdge: boolean,
  ) => {
    if (a === b || !nodeMap.has(a) || !nodeMap.has(b)) return;
    const [source, target] = a < b ? [a, b] : [b, a];
    const key = `${source}|${target}|${kind}`;
    let rec = linkAccum.get(key);
    if (!rec) {
      rec = { source, target, kind, weight: 0, days: new Set<number>(), isPrimaryRingEdge };
      linkAccum.set(key, rec);
    }
    rec.weight += weight;
    rec.isPrimaryRingEdge = rec.isPrimaryRingEdge || isPrimaryRingEdge;
    for (const d of days) rec.days.add(d);
    ensureAdj(source).add(target);
    ensureAdj(target).add(source);
  };

  for (const edge of data.edges) {
    const gid = makeAtlasNodeId("group", edge.group_id);
    const teacherIds = edge.second_teacher_id
      ? [makeAtlasNodeId("teacher", edge.teacher_id), makeAtlasNodeId("teacher", edge.second_teacher_id)]
      : [makeAtlasNodeId("teacher", edge.teacher_id)];

    for (const tid of teacherIds) {
      addLink(gid, tid, "teaches", edge.lessons_count, edge.days, true);
    }
  }

  // Curator relationships between groups and teachers
  for (const g of data.groups) {
    if (g.curator_id) {
      const gid = makeAtlasNodeId("group", g.id);
      const tid = makeAtlasNodeId("teacher", g.curator_id);
      addLink(gid, tid, "curator", 1, [], true);
    }
  }

  const links: AtlasGraphLink[] = Array.from(linkAccum.entries()).map(([id, rec]) => ({
    id,
    source: rec.source,
    target: rec.target,
    kind: rec.kind,
    weight: rec.weight,
    days: Array.from(rec.days).sort((x, y) => x - y),
    isPrimaryRingEdge: rec.isPrimaryRingEdge,
  }));

  for (const node of Array.from(nodeMap.values())) {
    const neighbors = adjacency.get(node.id);
    node.degree = neighbors ? neighbors.size : 0;
    node.isConnected = node.degree > 0 || node.lessonsCount > 0;
  }

  // Place connected groups & teachers on two clean concentric orbital rings
  const connectedGroups = Array.from(nodeMap.values())
    .filter((n) => n.kind === "group" && n.isConnected)
    .sort((a, b) => {
      const ca = a.course ?? 99;
      const cb = b.course ?? 99;
      if (ca !== cb) return ca - cb;
      return compareAtlasLabels(a.label, b.label);
    });

  const connectedTeachers = Array.from(nodeMap.values()).filter(
    (n) => n.kind === "teacher" && n.isConnected,
  );

  const rGroup = Math.max(210, (connectedGroups.length * 58) / (Math.PI * 2));
  const rTeacher = Math.max(rGroup + 210, (connectedTeachers.length * 44) / (Math.PI * 2));

  const angleMap = new Map<string, number>();
  const ringTargets = new Map<string, number>();

  // 1. Place groups by course sectors around inner orbit
  if (connectedGroups.length > 0) {
    const courseValues = new Set(connectedGroups.map((g) => g.course ?? 99));
    const sectorGap = courseValues.size > 1 ? 0.14 : 0;
    const totalGap = courseValues.size > 1 ? courseValues.size * sectorGap : 0;
    const usableArc = Math.PI * 2 - totalGap;
    const step = usableArc / connectedGroups.length;
    let cursor = -Math.PI / 2;
    let prevCourse: number | null = connectedGroups[0].course ?? 99;

    for (const g of connectedGroups) {
      const c = g.course ?? 99;
      if (c !== prevCourse) {
        cursor += sectorGap;
        prevCourse = c;
      }
      g.angle = cursor;
      g.x = Math.cos(cursor) * rGroup;
      g.y = Math.sin(cursor) * rGroup;
      angleMap.set(g.id, cursor);
      ringTargets.set(g.id, rGroup);
      cursor += step;
    }
  }

  // Pair weight lookup for centroid angular ordering
  const pairWeights = new Map<string, Map<string, number>>();
  for (const l of links) {
    if (!pairWeights.has(l.source)) pairWeights.set(l.source, new Map());
    if (!pairWeights.has(l.target)) pairWeights.set(l.target, new Map());
    pairWeights.get(l.source)!.set(l.target, (pairWeights.get(l.source)!.get(l.target) ?? 0) + l.weight);
    pairWeights.get(l.target)!.set(l.source, (pairWeights.get(l.target)!.get(l.source) ?? 0) + l.weight);
  }

  // 2. Place teachers near centroid of their groups
  const teacherDesired = new Map<string, number | null>();
  for (const t of connectedTeachers) {
    const adj = adjacency.get(t.id) ?? new Set<string>();
    const groupNeighbors = Array.from(adj).filter((id) => id.startsWith("group:"));
    teacherDesired.set(t.id, circularCentroid(groupNeighbors, angleMap, pairWeights.get(t.id)));
  }
  spreadRingByTargetAngle(connectedTeachers, rTeacher, teacherDesired, -Math.PI / 2);
  for (const t of connectedTeachers) {
    angleMap.set(t.id, t.angle);
    ringTargets.set(t.id, rTeacher);
  }

  // Place disconnected nodes neatly on a standby outer ring so selecting them via search still works cleanly
  const disconnected = Array.from(nodeMap.values()).filter((n) => !n.isConnected);
  const rStandby = rTeacher + 170;
  disconnected.forEach((n, idx) => {
    const theta = (idx / Math.max(1, disconnected.length)) * Math.PI * 2;
    n.angle = theta;
    n.x = Math.cos(theta) * rStandby;
    n.y = Math.sin(theta) * rStandby;
  });

  const connectedNodes = Array.from(nodeMap.values()).filter((n) => n.isConnected);
  // Only relax outer teachers so inner course-ordered group angles stay strictly sequential.
  relaxOrbitCollisions(connectedTeachers, ringTargets, 40);

  const rings: AtlasRingMeta[] = (
    [
      { radius: rGroup, kind: "group", label: "Групи", count: connectedGroups.length },
      { radius: rTeacher, kind: "teacher", label: "Викладачі", count: connectedTeachers.length },
    ] satisfies AtlasRingMeta[]
  ).filter((ring) => ring.count > 0);

  const bounds = computeBoundsFromPositions(connectedNodes.length > 0 ? connectedNodes : nodeMap.values());

  return {
    nodes: Array.from(nodeMap.values()),
    nodeMap,
    links,
    adjacency,
    rings,
    bounds,
    groupsRaw,
    teachersRaw,
    subjectsRaw,
    roomsRaw,
    edgesRaw: data.edges,
  };
}

function buildOrbitNeighborSubtitle(
  graph: AtlasGraph,
  center: AtlasGraphNode,
  neighbor: AtlasGraphNode,
): string | null {
  const isCenterGroup = center.kind === "group" && neighbor.kind === "teacher";
  const isCenterTeacher = center.kind === "teacher" && neighbor.kind === "group";
  if (!isCenterGroup && !isCenterTeacher) {
    return neighbor.subtitle;
  }

  const groupId = Number(isCenterGroup ? center.rawId : neighbor.rawId);
  const teacherId = Number(isCenterGroup ? neighbor.rawId : center.rawId);
  const isCurator = isCenterGroup
    ? center.curatorId === teacherId
    : neighbor.curatorId === teacherId;

  const subjectLessons = new Map<number, number>();
  const roomLessons = new Map<string, number>();

  for (const edge of graph.edgesRaw) {
    if (
      edge.group_id !== groupId ||
      (edge.teacher_id !== teacherId && edge.second_teacher_id !== teacherId)
    ) {
      continue;
    }
    subjectLessons.set(
      edge.subject_id,
      (subjectLessons.get(edge.subject_id) ?? 0) + edge.lessons_count,
    );
    const resolvedRoom = resolveTeacherEdgeRoom(graph, edge, teacherId);
    if (resolvedRoom) {
      roomLessons.set(resolvedRoom, (roomLessons.get(resolvedRoom) ?? 0) + edge.lessons_count);
    }
  }

  let topSubjectId: number | null = null;
  let topSubjectWeight = -1;
  for (const [sid, weight] of Array.from(subjectLessons.entries())) {
    if (weight > topSubjectWeight) {
      topSubjectWeight = weight;
      topSubjectId = sid;
    }
  }

  let topRoom: string | null = null;
  let topRoomWeight = -1;
  for (const [room, weight] of Array.from(roomLessons.entries())) {
    if (weight > topRoomWeight) {
      topRoomWeight = weight;
      topRoom = room;
    }
  }

  const rawSubj = topSubjectId !== null ? graph.subjectsRaw.get(topSubjectId) : undefined;
  const subjLabel = rawSubj ? rawSubj.name.trim() : null;
  const subjectPart =
    subjLabel && subjectLessons.size > 1
      ? `${subjLabel} +${subjectLessons.size - 1}`
      : subjLabel;

  const detailPart =
    subjectPart && topRoom
      ? `${subjectPart} · каб. ${topRoom}`
      : subjectPart
        ? subjectPart
        : topRoom
          ? `каб. ${topRoom}`
          : null;

  if (isCurator && detailPart) return `Куратор · ${detailPart}`;
  if (isCurator) return "Куратор";
  return detailPart;
}

/**
 * Arranges the selected node at (0, 0) and its direct neighbors in neat orbits.
 */
export function computeEgoLayout(graph: AtlasGraph, centerNodeId: string): AtlasLayoutSnapshot {
  const center = graph.nodeMap.get(centerNodeId);
  const visibleNodeIds = new Set<string>();
  const positions = new Map<string, AtlasNodePosition>();

  if (!center) {
    return {
      visibleNodeIds,
      positions,
      rings: [],
      bounds: { minX: -320, maxX: 320, minY: -320, maxY: 320 },
    };
  }

  visibleNodeIds.add(center.id);
  positions.set(center.id, {
    x: 0,
    y: 0,
    radius: 30,
    angle: 0,
    subtitle: center.subtitle,
  });

  const neighbors = Array.from(graph.adjacency.get(center.id) ?? [])
    .map((id) => graph.nodeMap.get(id))
    .filter((n): n is AtlasGraphNode => Boolean(n));

  neighbors.sort((a, b) => {
    if (center.kind === "teacher" && a.kind === "group" && b.kind === "group") {
      const ca = a.course ?? 99;
      const cb = b.course ?? 99;
      if (ca !== cb) return ca - cb;
      return compareAtlasLabels(a.label, b.label);
    }
    if (center.kind === "group" && a.kind === "teacher" && b.kind === "teacher") {
      const aCur = center.curatorId === Number(a.rawId) ? 0 : 1;
      const bCur = center.curatorId === Number(b.rawId) ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
      return compareAtlasLabels(a.label, b.label);
    }
    if (a.kind !== b.kind) return a.kind === "group" ? -1 : 1;
    return compareAtlasLabels(a.label, b.label);
  });

  const rings: Array<{ radius: number; label: string }> = [];

  if (neighbors.length === 0) {
    return {
      visibleNodeIds,
      positions,
      rings,
      bounds: { minX: -260, maxX: 260, minY: -260, maxY: 260 },
    };
  }

  const r =
    neighbors.length <= 12
      ? Math.max(210, neighbors.length * 32)
      : Math.max(260, (neighbors.length * 66) / (Math.PI * 2));
  const nodeRadiusBoost = neighbors.length <= 12 ? 1.15 : 1.1;
  const minNodeRadius = neighbors.length <= 12 ? 15 : 14;

  rings.push({ radius: r, label: "Прямі зв'язки" });
  neighbors.forEach((n, idx) => {
    const theta = -Math.PI / 2 + (idx / neighbors.length) * Math.PI * 2;
    visibleNodeIds.add(n.id);
    positions.set(n.id, {
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      radius: Math.max(minNodeRadius, n.radius * nodeRadiusBoost),
      angle: theta,
      subtitle: buildOrbitNeighborSubtitle(graph, center, n),
    });
  });

  const posValues = Array.from(positions.values());
  return {
    visibleNodeIds,
    positions,
    rings,
    bounds: computeBoundsFromPositions(posValues, 150),
  };
}

function collectNodeSubjectsAndRooms(
  graph: AtlasGraph,
  nodeId: string,
): { subjects: Map<number, number>; rooms: Map<string, number> } {
  const subjects = new Map<number, number>();
  const rooms = new Map<string, number>();
  const node = graph.nodeMap.get(nodeId);
  if (!node) return { subjects, rooms };

  const rawId = Number(node.rawId);
  if (node.kind === "teacher" && node.homeRoom && graph.roomsRaw.has(node.homeRoom)) {
    rooms.set(node.homeRoom, 0);
  }

  for (const edge of graph.edgesRaw) {
    const matches =
      node.kind === "group"
        ? edge.group_id === rawId
        : node.kind === "teacher"
          ? edge.teacher_id === rawId || edge.second_teacher_id === rawId
          : false;
    if (!matches) continue;

    subjects.set(edge.subject_id, (subjects.get(edge.subject_id) ?? 0) + edge.lessons_count);
    const resolvedRoom =
      node.kind === "teacher" ? resolveTeacherEdgeRoom(graph, edge, rawId) : edge.room;
    if (resolvedRoom) {
      rooms.set(resolvedRoom, (rooms.get(resolvedRoom) ?? 0) + edge.lessons_count);
    }
  }
  return { subjects, rooms };
}

function mergeIntersectionRows(
  rowA: AtlasRelationRow | undefined,
  rowB: AtlasRelationRow | undefined,
  nodeA: AtlasGraphNode | undefined,
  nodeB: AtlasGraphNode | undefined,
): AtlasRelationRow | null {
  const base = rowA ?? rowB;
  if (!base) return null;

  const days = Array.from(new Set([...(rowA?.days ?? []), ...(rowB?.days ?? [])])).sort(
    (x, y) => x - y,
  );
  const subjects = Array.from(new Set([...(rowA?.subjects ?? []), ...(rowB?.subjects ?? [])]));
  const rooms = Array.from(new Set([...(rowA?.rooms ?? []), ...(rowB?.rooms ?? [])])).sort(
    compareAtlasLabels,
  );
  const tags = Array.from(new Set([...(rowA?.tags ?? []), ...(rowB?.tags ?? [])]));

  let badge: string | null = null;
  if (rowA?.badge && rowB?.badge) {
    badge = rowA.badge;
  } else if (rowA?.badge) {
    badge = nodeA ? `${rowA.badge} (${nodeA.label})` : rowA.badge;
  } else if (rowB?.badge) {
    badge = nodeB ? `${rowB.badge} (${nodeB.label})` : rowB.badge;
  }

  return {
    node: base.node,
    lessonsCount: (rowA?.lessonsCount ?? 0) + (rowB?.lessonsCount ?? 0),
    days,
    tags,
    subjects,
    rooms,
    badge,
  };
}

/**
 * Computes direct shared neighbors (bridge nodes), subjects, rooms, and per-node differences between two selected nodes.
 */
export function computeNodeIntersection(
  graph: AtlasGraph,
  nodeAId: string,
  nodeBId: string,
): AtlasIntersectionResult {
  const nodeA = graph.nodeMap.get(nodeAId);
  const nodeB = graph.nodeMap.get(nodeBId);
  const adjA = graph.adjacency.get(nodeAId) ?? new Set<string>();
  const adjB = graph.adjacency.get(nodeBId) ?? new Set<string>();
  const directConnected = adjA.has(nodeBId);

  const sharedNodeIds = new Set<string>();
  const onlyAIds = new Set<string>();
  const onlyBIds = new Set<string>();

  for (const id of Array.from(adjA)) {
    if (id === nodeBId) continue;
    if (adjB.has(id)) {
      sharedNodeIds.add(id);
    } else {
      onlyAIds.add(id);
    }
  }
  for (const id of Array.from(adjB)) {
    if (id === nodeAId) continue;
    if (!adjA.has(id)) {
      onlyBIds.add(id);
    }
  }

  const sharedNodes = Array.from(sharedNodeIds)
    .map((id) => graph.nodeMap.get(id))
    .filter((n): n is AtlasGraphNode => Boolean(n))
    .sort((a, b) => b.lessonsCount - a.lessonsCount || compareAtlasLabels(a.label, b.label));

  const metaA = collectNodeSubjectsAndRooms(graph, nodeAId);
  const metaB = collectNodeSubjectsAndRooms(graph, nodeBId);

  const sharedSubjects: AtlasSharedSubjectSummary[] = [];
  for (const [sid, countA] of Array.from(metaA.subjects.entries())) {
    const countB = metaB.subjects.get(sid);
    if (countB === undefined) continue;
    const rawSubj = graph.subjectsRaw.get(sid);
    if (!rawSubj) continue;
    sharedSubjects.push({
      id: sid,
      label: rawSubj.name,
      lessonsCount: countA + countB,
    });
  }
  sharedSubjects.sort((a, b) => b.lessonsCount - a.lessonsCount || compareAtlasLabels(a.label, b.label));

  const sharedRooms: AtlasSharedRoomSummary[] = [];
  for (const [rName, countA] of Array.from(metaA.rooms.entries())) {
    const countB = metaB.rooms.get(rName);
    if (countB === undefined) continue;
    const rawRoom = graph.roomsRaw.get(rName);
    sharedRooms.push({
      name: rName,
      floor: rawRoom?.floor ?? null,
      lessonsCount: countA + countB,
    });
  }
  sharedRooms.sort((a, b) => b.lessonsCount - a.lessonsCount || compareAtlasLabels(a.name, b.name));

  const inspA = getNodeInspectorData(graph, nodeAId);
  const inspB = getNodeInspectorData(graph, nodeBId);
  const primaryA = nodeA?.kind === "group" ? inspA?.teachers ?? [] : inspA?.groups ?? [];
  const primaryB = nodeB?.kind === "group" ? inspB?.teachers ?? [] : inspB?.groups ?? [];
  const rowMapA = new Map(primaryA.map((r) => [r.node.id, r]));
  const rowMapB = new Map(primaryB.map((r) => [r.node.id, r]));

  const sharedRows = sharedNodes
    .map((n) => mergeIntersectionRows(rowMapA.get(n.id), rowMapB.get(n.id), nodeA, nodeB))
    .filter((r): r is AtlasRelationRow => Boolean(r))
    .sort((a, b) => b.lessonsCount - a.lessonsCount || compareAtlasLabels(a.node.label, b.node.label));

  const onlyARows = primaryA.filter((r) => onlyAIds.has(r.node.id));
  const onlyBRows = primaryB.filter((r) => onlyBIds.has(r.node.id));

  return {
    nodeAId,
    nodeBId,
    directConnected,
    sharedNodeIds,
    onlyAIds,
    onlyBIds,
    sharedByKind: {
      groups: sharedNodes.filter((n) => n.kind === "group"),
      teachers: sharedNodes.filter((n) => n.kind === "teacher"),
    },
    sharedSubjects,
    sharedRooms,
    sharedRows,
    onlyARows,
    onlyBRows,
  };
}

function formatCompareRowSubtitle(
  row: AtlasRelationRow | undefined,
  fallback: string | null,
): string | null {
  const mainSubj = row?.subjects[0] ?? null;
  const extraSubj = row && row.subjects.length > 1 ? ` +${row.subjects.length - 1}` : "";
  const mainRoom = row?.rooms[0] ? `каб. ${row.rooms[0]}` : null;
  const subParts = [mainSubj ? `${mainSubj}${extraSubj}` : null, mainRoom].filter(Boolean);
  return subParts.length > 0 ? subParts.join(" · ") : fallback;
}

/**
 * Arranges two compared nodes as twin anchors left/right with shared bridge nodes down the middle
 * and unique differences fanned cleanly to the outer left/right wings.
 */
export function computeCompareLayout(
  graph: AtlasGraph,
  intersection: AtlasIntersectionResult,
): AtlasLayoutSnapshot {
  const nodeA = graph.nodeMap.get(intersection.nodeAId);
  const nodeB = graph.nodeMap.get(intersection.nodeBId);
  const visibleNodeIds = new Set<string>();
  const positions = new Map<string, AtlasNodePosition>();

  if (!nodeA || !nodeB) {
    return {
      visibleNodeIds,
      positions,
      rings: [],
      bounds: { minX: -400, maxX: 400, minY: -300, maxY: 300 },
    };
  }

  const sharedNodes = [
    ...intersection.sharedByKind.teachers,
    ...intersection.sharedByKind.groups,
  ];
  const sharedRowMap = new Map(intersection.sharedRows.map((r) => [r.node.id, r]));

  const cols = sharedNodes.length > 6 ? 2 : 1;
  const anchorX = cols === 2 ? 390 : Math.max(320, Math.min(370, 270 + sharedNodes.length * 14));

  visibleNodeIds.add(nodeA.id);
  visibleNodeIds.add(nodeB.id);
  positions.set(nodeA.id, {
    x: -anchorX,
    y: 0,
    radius: Math.max(24, nodeA.radius * 1.4),
    angle: Math.PI,
    subtitle: `Спільних: ${sharedNodes.length} · Відмінних: ${intersection.onlyARows.length}`,
  });
  positions.set(nodeB.id, {
    x: anchorX,
    y: 0,
    radius: Math.max(24, nodeB.radius * 1.4),
    angle: 0,
    subtitle: `Спільних: ${sharedNodes.length} · Відмінних: ${intersection.onlyBRows.length}`,
  });

  // Place shared bridge nodes down x = 0 (split into two spaced columns when > 6)
  const spacingY = 128;
  const rowsPerCol = Math.ceil(sharedNodes.length / cols);
  sharedNodes.forEach((n, idx) => {
    const col = cols === 1 ? 0 : idx % 2 === 0 ? -1 : 1;
    const row = cols === 1 ? idx : Math.floor(idx / 2);
    const totalH = (rowsPerCol - 1) * spacingY;
    const y = -totalH / 2 + row * spacingY;
    const x = col * 136;

    const r = sharedRowMap.get(n.id);
    visibleNodeIds.add(n.id);
    positions.set(n.id, {
      x,
      y,
      radius: n.radius * 1.2,
      angle: -Math.PI / 2,
      subtitle: formatCompareRowSubtitle(r, n.subtitle),
    });
  });

  // Place up to 8 unique difference nodes on outer left (A) and outer right (B) wings
  const diffOffsetX = 256;
  const diffSpacingY = 114;
  const onlyANodes = intersection.onlyARows.slice(0, 8);
  const onlyBNodes = intersection.onlyBRows.slice(0, 8);

  if (onlyANodes.length > 0) {
    const totalOnlyAH = (onlyANodes.length - 1) * diffSpacingY;
    onlyANodes.forEach((r, idx) => {
      const y = -totalOnlyAH / 2 + idx * diffSpacingY;
      visibleNodeIds.add(r.node.id);
      positions.set(r.node.id, {
        x: -anchorX - diffOffsetX,
        y,
        radius: Math.max(12, r.node.radius * 1.05),
        angle: Math.PI,
        subtitle: formatCompareRowSubtitle(r, r.node.subtitle),
      });
    });
  }

  if (onlyBNodes.length > 0) {
    const totalOnlyBH = (onlyBNodes.length - 1) * diffSpacingY;
    onlyBNodes.forEach((r, idx) => {
      const y = -totalOnlyBH / 2 + idx * diffSpacingY;
      visibleNodeIds.add(r.node.id);
      positions.set(r.node.id, {
        x: anchorX + diffOffsetX,
        y,
        radius: Math.max(12, r.node.radius * 1.05),
        angle: 0,
        subtitle: formatCompareRowSubtitle(r, r.node.subtitle),
      });
    });
  }

  const bounds = computeBoundsFromPositions(positions.values(), 150);
  if (onlyANodes.length > 0) bounds.minX -= 165;
  if (onlyBNodes.length > 0) bounds.maxX += 165;
  if (sharedNodes.length > 0 || onlyANodes.length > 0 || onlyBNodes.length > 0) {
    bounds.minY -= 60;
    bounds.maxY += 36;
  }

  return {
    visibleNodeIds,
    positions,
    rings: [],
    bounds,
  };
}

/**
 * Extracts richly grouped inspector lists (teachers, groups, subjects, rooms) for the selected node.
 */
export function getNodeInspectorData(
  graph: AtlasGraph,
  nodeId: string,
): AtlasNodeInspectorData | null {
  const node = graph.nodeMap.get(nodeId);
  if (!node) return null;

  type AggRec = {
    lessons: number;
    days: Set<number>;
    tags: Set<string>;
    subjects: Map<string, number>;
    rooms: Set<string>;
    badge?: string | null;
  };

  const groupAgg = new Map<string, AggRec>();
  const teacherAgg = new Map<string, AggRec>();
  const subjectAgg = new Map<string, AggRec>();
  const roomAgg = new Map<string, AggRec>();

  const resolveInspectorTarget = (key: string): AtlasGraphNode | null => {
    const existing = graph.nodeMap.get(key);
    if (existing) return existing;

    if (key.startsWith("subject:")) {
      const sid = Number(key.slice("subject:".length));
      const s = graph.subjectsRaw.get(sid);
      if (!s) return null;
      return {
        id: key,
        rawId: s.id,
        kind: "subject",
        label: s.name,
        shortLabel: compactSubjectLabel(s.name, s.short_name),
        subtitle: `${s.groups_count} груп · ${s.teachers_count} викл.`,
        course: null,
        floor: null,
        curatorId: null,
        facultyName: null,
        fullName: null,
        homeRoom: null,
        lessonsCount: s.lessons_count,
        degree: 0,
        isConnected: true,
        x: 0,
        y: 0,
        radius: 12,
        angle: 0,
        ringIndex: 2,
      };
    }

    if (key.startsWith("room:")) {
      const rKey = key.slice("room:".length);
      const r = graph.roomsRaw.get(rKey);
      if (!r) return null;
      return {
        id: key,
        rawId: r.id,
        kind: "room",
        label: r.name,
        shortLabel: r.name,
        subtitle: r.floor ? `${r.floor} поверх` : "Спец. приміщення",
        course: null,
        floor: r.floor,
        curatorId: null,
        facultyName: null,
        fullName: null,
        homeRoom: null,
        lessonsCount: r.lessons_count,
        degree: 0,
        isConnected: true,
        x: 0,
        y: 0,
        radius: 10,
        angle: 0,
        ringIndex: 3,
      };
    }

    return null;
  };

  const bump = (
    map: Map<string, AggRec>,
    key: string,
    lessons: number,
    days: number[],
    tag?: string | null,
    badge?: string | null,
    subjectName?: string | null,
    roomName?: string | null,
  ) => {
    if (!resolveInspectorTarget(key)) return;
    let rec = map.get(key);
    if (!rec) {
      rec = {
        lessons: 0,
        days: new Set<number>(),
        tags: new Set<string>(),
        subjects: new Map<string, number>(),
        rooms: new Set<string>(),
        badge: null,
      };
      map.set(key, rec);
    }
    rec.lessons += lessons;
    for (const d of days) rec.days.add(d);
    if (tag) rec.tags.add(tag);
    if (subjectName) {
      rec.subjects.set(subjectName, (rec.subjects.get(subjectName) ?? 0) + lessons);
    }
    if (roomName) rec.rooms.add(roomName);
    if (badge) rec.badge = badge;
  };

  const curatedGroups: AtlasGraphNode[] = [];
  let curatorTeacher: AtlasGraphNode | null = null;

  if (node.kind === "group") {
    const rawGroupId = Number(node.rawId);
    if (node.curatorId) {
      const tid = makeAtlasNodeId("teacher", node.curatorId);
      curatorTeacher = graph.nodeMap.get(tid) ?? null;
      if (curatorTeacher) {
        bump(teacherAgg, tid, 0, [], undefined, "Куратор");
      }
    }
    for (const e of graph.edgesRaw) {
      if (e.group_id !== rawGroupId) continue;
      const rawSubj = graph.subjectsRaw.get(e.subject_id);
      const fullSubjName = rawSubj?.name?.trim() || rawSubj?.short_name?.trim() || undefined;
      const tIds = e.second_teacher_id ? [e.teacher_id, e.second_teacher_id] : [e.teacher_id];
      const tNames = tIds.map((id) => graph.teachersRaw.get(id)?.name).filter(Boolean).join(", ");
      const sid = makeAtlasNodeId("subject", e.subject_id);
      const subjectTag = [tNames, e.room ? `каб. ${e.room}` : null].filter(Boolean).join(" · ");
      bump(subjectAgg, sid, e.lessons_count, e.days, subjectTag || undefined);

      for (const tId of tIds) {
        const tid = makeAtlasNodeId("teacher", tId);
        const resolvedRoom = resolveTeacherEdgeRoom(graph, e, tId);
        bump(
          teacherAgg,
          tid,
          e.lessons_count,
          e.days,
          fullSubjName,
          undefined,
          fullSubjName,
          resolvedRoom || undefined,
        );
      }
      if (e.room) {
        const rid = makeAtlasNodeId("room", e.room);
        bump(roomAgg, rid, e.lessons_count, e.days, fullSubjName);
      }
    }
  } else if (node.kind === "teacher") {
    const rawTeacherId = Number(node.rawId);
    for (const g of Array.from(graph.groupsRaw.values())) {
      if (g.curator_id === rawTeacherId) {
        const gid = makeAtlasNodeId("group", g.id);
        const gNode = graph.nodeMap.get(gid);
        if (gNode) curatedGroups.push(gNode);
        bump(groupAgg, gid, 0, [], undefined, "Кураторство");
      }
    }
    if (node.homeRoom) {
      const rid = makeAtlasNodeId("room", node.homeRoom);
      if (resolveInspectorTarget(rid)) {
        bump(roomAgg, rid, 0, [], undefined, "Закріплена");
      }
    }
    for (const e of graph.edgesRaw) {
      if (e.teacher_id !== rawTeacherId && e.second_teacher_id !== rawTeacherId) continue;
      const gid = makeAtlasNodeId("group", e.group_id);
      const sid = makeAtlasNodeId("subject", e.subject_id);
      const gName = graph.groupsRaw.get(e.group_id)?.name;
      const rawSubj = graph.subjectsRaw.get(e.subject_id);
      const fullSubjName = rawSubj?.name?.trim() || rawSubj?.short_name?.trim() || undefined;
      const resolvedRoom = resolveTeacherEdgeRoom(graph, e, rawTeacherId);
      bump(
        groupAgg,
        gid,
        e.lessons_count,
        e.days,
        fullSubjName,
        undefined,
        fullSubjName,
        resolvedRoom || undefined,
      );
      const subjectTag = [gName, resolvedRoom ? `каб. ${resolvedRoom}` : null].filter(Boolean).join(" · ");
      bump(subjectAgg, sid, e.lessons_count, e.days, subjectTag || undefined);
      if (resolvedRoom) {
        const rid = makeAtlasNodeId("room", resolvedRoom);
        bump(roomAgg, rid, e.lessons_count, e.days, gName || undefined);
      }
    }
  }

  const finalize = (map: Map<string, AggRec>, isGroupList = false): AtlasRelationRow[] => {
    const out: AtlasRelationRow[] = [];
    for (const [id, rec] of Array.from(map.entries())) {
      const targetNode = resolveInspectorTarget(id);
      if (!targetNode) continue;
      const subjects = Array.from(rec.subjects.entries())
        .sort((a, b) => b[1] - a[1] || compareAtlasLabels(a[0], b[0]))
        .map(([name]) => name);
      const rooms = Array.from(rec.rooms).sort(compareAtlasLabels);
      out.push({
        node: targetNode,
        lessonsCount: rec.lessons,
        days: Array.from(rec.days).sort((a, b) => a - b),
        tags: Array.from(rec.tags),
        subjects,
        rooms,
        badge: rec.badge ?? null,
      });
    }
    out.sort((a, b) => {
      if (Boolean(b.badge) !== Boolean(a.badge)) return b.badge ? 1 : -1;
      if (isGroupList) {
        const ca = a.node.course ?? 99;
        const cb = b.node.course ?? 99;
        if (ca !== cb) return ca - cb;
        return compareAtlasLabels(a.node.label, b.node.label);
      }
      if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
      return compareAtlasLabels(a.node.label, b.node.label);
    });
    return out;
  };

  curatedGroups.sort(
    (a, b) => (a.course ?? 99) - (b.course ?? 99) || compareAtlasLabels(a.label, b.label),
  );

  return {
    node,
    curatorTeacher,
    curatedGroups,
    groups: finalize(groupAgg, true),
    teachers: finalize(teacherAgg),
    subjects: finalize(subjectAgg),
    rooms: finalize(roomAgg),
  };
}

const DAY_NAMES_SEARCH: Record<number, string> = {
  1: "пн понеділок",
  2: "вт вівторок",
  3: "ср середа",
  4: "чт четвер",
  5: "пт п'ятниця пятниця",
  6: "сб субота",
  7: "нд неділя",
};

/**
 * Deterministically sorts inspector/compare relation rows by the user's chosen criterion.
 */
export function sortAtlasRelationRows(
  rows: readonly AtlasRelationRow[],
  sortBy: AtlasRelationSortKey,
): AtlasRelationRow[] {
  const copy = [...rows];
  copy.sort((a, b) => {
    if (sortBy === "alpha") {
      const cmp = compareAtlasLabels(a.node.label, b.node.label);
      if (cmp !== 0) return cmp;
      return b.lessonsCount - a.lessonsCount;
    }

    if (sortBy === "course") {
      const ca = a.node.course ?? 99;
      const cb = b.node.course ?? 99;
      if (ca !== cb) return ca - cb;
      const cmp = compareAtlasLabels(a.node.label, b.node.label);
      if (cmp !== 0) return cmp;
      return b.lessonsCount - a.lessonsCount;
    }

    if (sortBy === "room") {
      const roomA = a.node.kind === "room" ? a.node.label : (a.rooms[0] ?? "");
      const roomB = b.node.kind === "room" ? b.node.label : (b.rooms[0] ?? "");
      const hasA = Boolean(roomA);
      const hasB = Boolean(roomB);
      if (hasA !== hasB) return hasA ? -1 : 1;
      if (roomA && roomB) {
        const cmp = compareAtlasLabels(roomA, roomB);
        if (cmp !== 0) return cmp;
      }
      if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
      return compareAtlasLabels(a.node.label, b.node.label);
    }

    if (sortBy === "day") {
      const dayA = a.days.length > 0 ? a.days[0] : 99;
      const dayB = b.days.length > 0 ? b.days[0] : 99;
      if (dayA !== dayB) return dayA - dayB;
      if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
      return compareAtlasLabels(a.node.label, b.node.label);
    }

    // Default: "lessons" (workload desc, badges first)
    if (Boolean(b.badge) !== Boolean(a.badge)) return b.badge ? 1 : -1;
    if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
    if (a.node.kind === "group" && b.node.kind === "group") {
      const ca = a.node.course ?? 99;
      const cb = b.node.course ?? 99;
      if (ca !== cb) return ca - cb;
    }
    return compareAtlasLabels(a.node.label, b.node.label);
  });
  return copy;
}

/**
 * Filters inspector/compare relation rows by name, full name, subject, room, badge, or day of week.
 */
export function filterAtlasRelationRows(
  rows: readonly AtlasRelationRow[],
  query: string,
): AtlasRelationRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...rows];

  return rows.filter((row) => {
    if (row.node.label.toLowerCase().includes(needle)) return true;
    if (row.node.fullName && row.node.fullName.toLowerCase().includes(needle)) return true;
    if (row.node.subtitle && row.node.subtitle.toLowerCase().includes(needle)) return true;
    if (row.badge && row.badge.toLowerCase().includes(needle)) return true;
    if (row.subjects.some((s) => s.toLowerCase().includes(needle))) return true;
    if (row.rooms.some((r) => r.toLowerCase().includes(needle) || `каб. ${r}`.toLowerCase().includes(needle))) {
      return true;
    }
    if (row.tags.some((t) => t.toLowerCase().includes(needle))) return true;
    if (row.days.some((d) => (DAY_NAMES_SEARCH[d] ?? "").includes(needle))) return true;
    return false;
  });
}

/**
 * Computes context-aware, logically ordered candidates for the "Compare Intersection" picker.
 * - For a Group: prioritizes groups of the same course & faculty in natural code order (so sister groups like 85 <-> 86 are first),
 *   and computes shared neighbor counts.
 * - For a Teacher: prioritizes colleague teachers who share groups with this teacher, sorted by shared group count.
 */
export function getCompareCandidates(
  graph: AtlasGraph,
  baseNodeId: string,
  options?: {
    query?: string;
    scope?: AtlasCompareScope;
    limit?: number;
  },
): AtlasCompareCandidate[] {
  const baseNode = graph.nodeMap.get(baseNodeId);
  if (!baseNode) return [];

  const needle = (options?.query ?? "").trim().toLowerCase();
  const scope: AtlasCompareScope = options?.scope ?? "recommended";
  const limit = options?.limit ?? 24;
  const baseAdj = graph.adjacency.get(baseNode.id) ?? new Set<string>();

  const candidates: AtlasCompareCandidate[] = [];

  for (const node of graph.nodes) {
    if (node.id === baseNode.id || !node.isConnected) continue;
    if (scope === "groups" && node.kind !== "group") continue;
    if (scope === "teachers" && node.kind !== "teacher") continue;

    // Count shared direct neighbors (teachers for two groups, groups for two teachers)
    const nodeAdj = graph.adjacency.get(node.id) ?? new Set<string>();
    let sharedCount = 0;
    for (const nbId of Array.from(baseAdj)) {
      if (nbId !== node.id && nodeAdj.has(nbId)) {
        sharedCount++;
      }
    }
    const isDirectNeighbor = baseAdj.has(node.id);

    // Search match check if query is non-empty
    let textMatchScore = 0;
    if (needle) {
      const labelLow = node.label.toLowerCase();
      const fullLow = (node.fullName ?? "").toLowerCase();
      const subLow = (node.subtitle ?? "").toLowerCase();
      if (labelLow === needle) textMatchScore = 200;
      else if (labelLow.startsWith(needle)) textMatchScore = 140;
      else if (fullLow.startsWith(needle)) textMatchScore = 120;
      else if (labelLow.includes(needle)) textMatchScore = 90;
      else if (fullLow.includes(needle) || subLow.includes(needle)) textMatchScore = 60;
      if (textMatchScore === 0) continue;
    }

    let score = textMatchScore;
    let reasonHint: string | null = null;

    if (baseNode.kind === "group") {
      if (node.kind === "group") {
        const sameCourse = baseNode.course !== null && node.course === baseNode.course;
        const sameFaculty = Boolean(baseNode.facultyName && node.facultyName === baseNode.facultyName);
        if (sameCourse) {
          score += 500;
          if (sameFaculty) score += 120;
        } else {
          score += 150;
        }
        score += sharedCount * 18;
        const parts: string[] = [];
        if (node.course) parts.push(`${node.course}к`);
        if (sharedCount > 0) parts.push(`спільних: ${sharedCount}`);
        reasonHint = parts.length > 0 ? parts.join(" · ") : null;
      } else {
        // Teacher candidate when base is group
        if (isDirectNeighbor) {
          score += 80;
          reasonHint = "Викладач групи";
        } else {
          score += 10;
        }
      }
    } else {
      // baseNode is teacher
      if (node.kind === "teacher") {
        if (sharedCount > 0) {
          score += 400 + sharedCount * 25;
          reasonHint = `спільних груп: ${sharedCount}`;
        } else {
          score += 120;
        }
      } else if (node.kind === "group") {
        if (isDirectNeighbor) {
          score += 220;
          reasonHint = node.course ? `${node.course}к · ваша група` : "ваша група";
        } else {
          score += 40;
          reasonHint = node.course ? `${node.course}к` : null;
        }
      }
    }

    // In "recommended" mode without query, keep only same-kind or connected high-signal items first
    if (!needle && scope === "recommended" && node.kind !== baseNode.kind && !isDirectNeighbor) {
      continue;
    }

    candidates.push({
      node,
      sharedCount,
      reasonHint,
      score,
    });
  }

  candidates.sort((a, b) => {
    if (needle && b.score !== a.score) return b.score - a.score;

    if (scope === "groups" || (scope === "recommended" && baseNode.kind === "group")) {
      // Group-first ordering: same course first, then natural group code order within each course
      if (a.node.kind !== b.node.kind) return a.node.kind === "group" ? -1 : 1;
      if (a.node.kind === "group" && b.node.kind === "group") {
        const aSameCourse = baseNode.kind === "group" && baseNode.course !== null && a.node.course === baseNode.course ? 0 : 1;
        const bSameCourse = baseNode.kind === "group" && baseNode.course !== null && b.node.course === baseNode.course ? 0 : 1;
        if (aSameCourse !== bSameCourse) return aSameCourse - bSameCourse;
        const ca = a.node.course ?? 99;
        const cb = b.node.course ?? 99;
        if (ca !== cb) return ca - cb;
        return compareAtlasLabels(a.node.label, b.node.label);
      }
    }

    if (b.score !== a.score) return b.score - a.score;
    if (b.sharedCount !== a.sharedCount) return b.sharedCount - a.sharedCount;
    return compareAtlasLabels(a.node.label, b.node.label);
  });

  return candidates.slice(0, limit);
}
