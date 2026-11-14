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
}

export interface AtlasRelationRow {
  node: AtlasGraphNode;
  lessonsCount: number;
  days: number[];
  tags: string[];
  badge?: string | null;
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
    return a.node.label.localeCompare(b.node.label, "uk");
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
      const fa = a.facultyName ?? "";
      const fb = b.facultyName ?? "";
      if (fa !== fb) return fa.localeCompare(fb, "uk");
      return a.label.localeCompare(b.label, "uk");
    });

  const connectedTeachers = Array.from(nodeMap.values()).filter(
    (n) => n.kind === "teacher" && n.isConnected,
  );

  const rGroup = Math.max(190, (connectedGroups.length * 42) / (Math.PI * 2));
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
  relaxOrbitCollisions(connectedNodes, ringTargets, 40);

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
    if (edge.room) {
      roomLessons.set(edge.room, (roomLessons.get(edge.room) ?? 0) + edge.lessons_count);
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
  const subjLabel = rawSubj ? compactSubjectLabel(rawSubj.name, rawSubj.short_name) : null;
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
    if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
    return a.label.localeCompare(b.label, "uk");
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

  if (neighbors.length <= 12) {
    const r = Math.max(210, neighbors.length * 32);
    rings.push({ radius: r, label: "Прямі зв'язки" });
    neighbors.forEach((n, idx) => {
      const theta = -Math.PI / 2 + (idx / neighbors.length) * Math.PI * 2;
      visibleNodeIds.add(n.id);
      positions.set(n.id, {
        x: Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        radius: Math.max(15, n.radius * 1.15),
        angle: theta,
        subtitle: buildOrbitNeighborSubtitle(graph, center, n),
      });
    });
  } else {
    const baseR = Math.max(250, (neighbors.length * 58) / (Math.PI * 2));
    rings.push({ radius: baseR, label: "Прямі зв'язки" });
    neighbors.forEach((n, idx) => {
      const theta = -Math.PI / 2 + (idx / neighbors.length) * Math.PI * 2;
      const ringR = baseR + (idx % 2 === 0 ? -24 : 24);
      visibleNodeIds.add(n.id);
      positions.set(n.id, {
        x: Math.cos(theta) * ringR,
        y: Math.sin(theta) * ringR,
        radius: Math.max(14, n.radius * 1.1),
        angle: theta,
        subtitle: buildOrbitNeighborSubtitle(graph, center, n),
      });
    });
  }

  const posValues = Array.from(positions.values());
  return {
    visibleNodeIds,
    positions,
    rings,
    bounds: computeBoundsFromPositions(posValues, 120),
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
    if (edge.room) {
      rooms.set(edge.room, (rooms.get(edge.room) ?? 0) + edge.lessons_count);
    }
  }
  return { subjects, rooms };
}

/**
 * Computes direct shared neighbors (bridge nodes), subjects, and rooms between two selected nodes.
 */
export function computeNodeIntersection(
  graph: AtlasGraph,
  nodeAId: string,
  nodeBId: string,
): AtlasIntersectionResult {
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
    .sort((a, b) => b.lessonsCount - a.lessonsCount || a.label.localeCompare(b.label, "uk"));

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
  sharedSubjects.sort((a, b) => b.lessonsCount - a.lessonsCount || a.label.localeCompare(b.label, "uk"));

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
  sharedRooms.sort((a, b) => b.lessonsCount - a.lessonsCount || a.name.localeCompare(b.name, "uk"));

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
  };
}

/**
 * Arranges two compared nodes as twin anchors left/right with their shared bridge nodes stacked down the middle.
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
  const onlyANodes = Array.from(intersection.onlyAIds)
    .map((id) => graph.nodeMap.get(id))
    .filter((n): n is AtlasGraphNode => Boolean(n))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.lessonsCount - a.lessonsCount);
  const onlyBNodes = Array.from(intersection.onlyBIds)
    .map((id) => graph.nodeMap.get(id))
    .filter((n): n is AtlasGraphNode => Boolean(n))
    .sort((a, b) => a.kind.localeCompare(b.kind) || b.lessonsCount - a.lessonsCount);

  const anchorX = Math.max(260, Math.min(360, 220 + sharedNodes.length * 10));
  visibleNodeIds.add(nodeA.id);
  visibleNodeIds.add(nodeB.id);
  positions.set(nodeA.id, { x: -anchorX, y: 0, radius: Math.max(24, nodeA.radius * 1.4), angle: Math.PI });
  positions.set(nodeB.id, { x: anchorX, y: 0, radius: Math.max(24, nodeB.radius * 1.4), angle: 0 });

  // Place shared bridge nodes down x = 0 (split into two close columns if > 10)
  const spacingY = 66;
  const cols = sharedNodes.length > 10 ? 2 : 1;
  const rowsPerCol = Math.ceil(sharedNodes.length / cols);
  sharedNodes.forEach((n, idx) => {
    const col = cols === 1 ? 0 : idx % 2 === 0 ? -1 : 1;
    const row = cols === 1 ? idx : Math.floor(idx / 2);
    const totalH = (rowsPerCol - 1) * spacingY;
    const y = -totalH / 2 + row * spacingY;
    const x = col * 58;
    visibleNodeIds.add(n.id);
    positions.set(n.id, { x, y, radius: n.radius * 1.18, angle: -Math.PI / 2 });
  });

  // Fan unique neighbors along left and right outer semi-circles
  const fanOuter = (items: AtlasGraphNode[], cx: number, startAngle: number, endAngle: number) => {
    if (items.length === 0) return;
    const r = Math.max(195, (items.length * 58) / Math.PI);
    items.forEach((n, idx) => {
      const t = items.length === 1 ? 0.5 : idx / (items.length - 1);
      const theta = startAngle + (endAngle - startAngle) * t;
      visibleNodeIds.add(n.id);
      positions.set(n.id, {
        x: cx + Math.cos(theta) * r,
        y: Math.sin(theta) * r,
        radius: n.radius * 0.96,
        angle: theta,
      });
    });
  };

  fanOuter(onlyANodes, -anchorX, (Math.PI * 2) / 3, (Math.PI * 4) / 3);
  fanOuter(onlyBNodes, anchorX, -Math.PI / 3, Math.PI / 3);

  return {
    visibleNodeIds,
    positions,
    rings: [],
    bounds: computeBoundsFromPositions(positions.values()),
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

  const groupAgg = new Map<string, { lessons: number; days: Set<number>; tags: Set<string>; badge?: string | null }>();
  const teacherAgg = new Map<string, { lessons: number; days: Set<number>; tags: Set<string>; badge?: string | null }>();
  const subjectAgg = new Map<string, { lessons: number; days: Set<number>; tags: Set<string>; badge?: string | null }>();
  const roomAgg = new Map<string, { lessons: number; days: Set<number>; tags: Set<string>; badge?: string | null }>();

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
    map: Map<string, { lessons: number; days: Set<number>; tags: Set<string>; badge?: string | null }>,
    key: string,
    lessons: number,
    days: number[],
    tag?: string | null,
    badge?: string | null,
  ) => {
    if (!resolveInspectorTarget(key)) return;
    let rec = map.get(key);
    if (!rec) {
      rec = { lessons: 0, days: new Set<number>(), tags: new Set<string>(), badge: null };
      map.set(key, rec);
    }
    rec.lessons += lessons;
    for (const d of days) rec.days.add(d);
    if (tag) rec.tags.add(tag);
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
      const subjName = graph.subjectsRaw.get(e.subject_id)?.short_name || graph.subjectsRaw.get(e.subject_id)?.name;
      const tIds = e.second_teacher_id ? [e.teacher_id, e.second_teacher_id] : [e.teacher_id];
      const tNames = tIds.map((id) => graph.teachersRaw.get(id)?.name).filter(Boolean).join(", ");
      const sid = makeAtlasNodeId("subject", e.subject_id);
      const subjectTag = [tNames, e.room ? `каб. ${e.room}` : null].filter(Boolean).join(" · ");
      bump(subjectAgg, sid, e.lessons_count, e.days, subjectTag || undefined);

      for (const tId of tIds) {
        const tid = makeAtlasNodeId("teacher", tId);
        bump(teacherAgg, tid, e.lessons_count, e.days, subjName || undefined);
      }
      if (e.room) {
        const rid = makeAtlasNodeId("room", e.room);
        bump(roomAgg, rid, e.lessons_count, e.days, subjName || undefined);
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
      const sName = graph.subjectsRaw.get(e.subject_id)?.short_name || graph.subjectsRaw.get(e.subject_id)?.name;
      bump(groupAgg, gid, e.lessons_count, e.days, sName || undefined);
      const subjectTag = [gName, e.room ? `каб. ${e.room}` : null].filter(Boolean).join(" · ");
      bump(subjectAgg, sid, e.lessons_count, e.days, subjectTag || undefined);
      if (e.room) {
        const rid = makeAtlasNodeId("room", e.room);
        bump(roomAgg, rid, e.lessons_count, e.days, gName || undefined);
      }
    }
  }

  const finalize = (
    map: Map<string, { lessons: number; days: Set<number>; tags: Set<string>; badge?: string | null }>,
  ): AtlasRelationRow[] => {
    const out: AtlasRelationRow[] = [];
    for (const [id, rec] of Array.from(map.entries())) {
      const targetNode = resolveInspectorTarget(id);
      if (!targetNode) continue;
      out.push({
        node: targetNode,
        lessonsCount: rec.lessons,
        days: Array.from(rec.days).sort((a, b) => a - b),
        tags: Array.from(rec.tags),
        badge: rec.badge ?? null,
      });
    }
    out.sort((a, b) => {
      if (Boolean(b.badge) !== Boolean(a.badge)) return b.badge ? 1 : -1;
      if (b.lessonsCount !== a.lessonsCount) return b.lessonsCount - a.lessonsCount;
      return a.node.label.localeCompare(b.node.label, "uk");
    });
    return out;
  };

  curatedGroups.sort((a, b) => a.label.localeCompare(b.label, "uk"));

  return {
    node,
    curatorTeacher,
    curatedGroups,
    groups: finalize(groupAgg),
    teachers: finalize(teacherAgg),
    subjects: finalize(subjectAgg),
    rooms: finalize(roomAgg),
  };
}
