const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

function loadAtlasEngine() {
  return loadTsModule(path.join(__dirname, "../lib/atlas/graphEngine.ts"));
}

function makeSampleAtlasPayload() {
  return {
    summary: {
      groups_count: 2,
      teachers_count: 2,
      subjects_count: 2,
      rooms_count: 2,
      edges_count: 3,
    },
    groups: [
      {
        id: 10,
        name: "АБ-21",
        course: 2,
        faculty_id: 1,
        faculty_name: "Відділення комп'ютерних технологій",
        curator_id: 100,
        lessons_count: 5,
      },
      {
        id: 11,
        name: "ВГ-21",
        course: 2,
        faculty_id: 1,
        faculty_name: "Відділення комп'ютерних технологій",
        curator_id: 101,
        lessons_count: 4,
      },
    ],
    teachers: [
      {
        id: 100,
        name: "Коваль О. І.",
        full_name: "Коваль Олександр Іванович",
        room: "205",
        groups_count: 2,
        subjects_count: 1,
        lessons_count: 6,
      },
      {
        id: 101,
        name: "Бойко М. С.",
        full_name: "Бойко Марія Сергіївна",
        room: "104",
        groups_count: 1,
        subjects_count: 1,
        lessons_count: 3,
      },
    ],
    subjects: [
      {
        id: 200,
        name: "Алгоритми та структури даних",
        short_name: "АСД",
        groups_count: 2,
        teachers_count: 1,
        lessons_count: 6,
      },
      {
        id: 201,
        name: "Англійська мова за професійним спрямуванням",
        short_name: null,
        groups_count: 1,
        teachers_count: 2,
        lessons_count: 3,
      },
    ],
    rooms: [
      { id: "205", name: "205", floor: 2, groups_count: 2, teachers_count: 1, lessons_count: 6 },
      { id: "104", name: "104", floor: 1, groups_count: 1, teachers_count: 2, lessons_count: 3 },
    ],
    edges: [
      {
        group_id: 10,
        teacher_id: 100,
        second_teacher_id: null,
        subject_id: 200,
        room: "205",
        lessons_count: 3,
        days: [1, 3],
      },
      {
        group_id: 11,
        teacher_id: 100,
        second_teacher_id: null,
        subject_id: 200,
        room: "205",
        lessons_count: 3,
        days: [2, 4],
      },
      {
        group_id: 10,
        teacher_id: 101,
        second_teacher_id: 100,
        subject_id: 201,
        room: "104",
        lessons_count: 2,
        days: [5],
      },
    ],
  };
}

test("buildAtlasGraph produces deterministic 2-kind coordinates, rings, and adjacency", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();

  const graphA = engine.buildAtlasGraph(payload);
  const graphB = engine.buildAtlasGraph(payload);

  assert.equal(graphA.nodes.length, 4);
  assert.equal(graphA.rings.length, 2);
  assert.ok(graphA.links.length > 0);
  assert.ok(graphA.nodes.every((n) => n.kind === "group" || n.kind === "teacher"));

  for (let i = 0; i < graphA.nodes.length; i++) {
    const a = graphA.nodes[i];
    const b = graphB.nodes[i];
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), `Expected finite coords for ${a.id}`);
    assert.equal(a.x, b.x);
    assert.equal(a.y, b.y);
    assert.equal(a.isConnected, true);
  }

  const g10Id = engine.makeAtlasNodeId("group", 10);
  const t100Id = engine.makeAtlasNodeId("teacher", 100);
  const t101Id = engine.makeAtlasNodeId("teacher", 101);
  assert.equal(graphA.adjacency.get(g10Id).has(t100Id), true);
  assert.equal(graphA.adjacency.get(g10Id).has(t101Id), true);
});

test("computeEgoLayout centers selected node at origin with neighbor orbits and subtitles", () => {
  const engine = loadAtlasEngine();
  const graph = engine.buildAtlasGraph(makeSampleAtlasPayload());
  const centerId = engine.makeAtlasNodeId("group", 10);
  const t100Id = engine.makeAtlasNodeId("teacher", 100);
  const t101Id = engine.makeAtlasNodeId("teacher", 101);

  const ego = engine.computeEgoLayout(graph, centerId);
  assert.equal(ego.visibleNodeIds.has(centerId), true);

  const centerPos = ego.positions.get(centerId);
  assert.deepEqual({ x: centerPos.x, y: centerPos.y }, { x: 0, y: 0 });
  assert.equal(centerPos.radius, 30);
  assert.equal(ego.rings.length, 1);

  for (const neighborId of graph.adjacency.get(centerId)) {
    assert.equal(ego.visibleNodeIds.has(neighborId), true);
    const nPos = ego.positions.get(neighborId);
    assert.ok(Math.hypot(nPos.x, nPos.y) > 150);
  }

  const t100Sub = ego.positions.get(t100Id).subtitle;
  assert.ok(t100Sub && t100Sub.includes("Куратор") && t100Sub.includes("Алгоритми та структури даних") && t100Sub.includes("205"));
  const t101Sub = ego.positions.get(t101Id).subtitle;
  assert.ok(t101Sub && t101Sub.includes("Англійська мова за професійним спрямуванням") && t101Sub.includes("каб. 104"));
  assert.ok(!t101Sub.includes("…"));
});

test("computeEgoLayout uses a single smooth circle when neighbor count exceeds 12", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();
  for (let i = 1; i <= 13; i++) {
    const teacherId = 300 + i;
    payload.teachers.push({
      id: teacherId,
      name: `Викладач ${i}`,
      full_name: `Викладач Повний ${i}`,
      room: "205",
      groups_count: 1,
      subjects_count: 1,
      lessons_count: 2,
    });
    payload.edges.push({
      group_id: 10,
      teacher_id: teacherId,
      second_teacher_id: null,
      subject_id: 200,
      room: "205",
      lessons_count: 2,
      days: [1],
    });
  }

  const graph = engine.buildAtlasGraph(payload);
  const centerId = engine.makeAtlasNodeId("group", 10);
  const ego = engine.computeEgoLayout(graph, centerId);
  assert.equal(ego.rings.length, 1);

  const radii = new Set();
  for (const [id, pos] of ego.positions.entries()) {
    if (id !== centerId) {
      radii.add(Math.round(Math.hypot(pos.x, pos.y)));
    }
  }
  assert.equal(radii.size, 1);
  const [singleRadius] = Array.from(radii);
  assert.ok(singleRadius >= 260);
});

test("computeNodeIntersection and computeCompareLayout highlight shared bridges, subjects, rooms, and per-node diffs", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();
  payload.teachers.push({
    id: 102,
    name: "Мельник І. В.",
    full_name: "Мельник Іван Васильович",
    room: "301",
    groups_count: 1,
    subjects_count: 1,
    lessons_count: 2,
  });
  payload.edges.push({
    group_id: 10,
    teacher_id: 102,
    second_teacher_id: null,
    subject_id: 201,
    room: "301",
    lessons_count: 2,
    days: [4],
  });
  const graph = engine.buildAtlasGraph(payload);

  const g10Id = engine.makeAtlasNodeId("group", 10);
  const g11Id = engine.makeAtlasNodeId("group", 11);
  const t100Id = engine.makeAtlasNodeId("teacher", 100);
  const t101Id = engine.makeAtlasNodeId("teacher", 101);
  const t102Id = engine.makeAtlasNodeId("teacher", 102);

  const intersection = engine.computeNodeIntersection(graph, g10Id, g11Id);
  assert.equal(intersection.directConnected, false);
  assert.equal(intersection.sharedNodeIds.has(t100Id), true);
  assert.equal(intersection.sharedNodeIds.has(t101Id), true);
  assert.equal(intersection.sharedByKind.teachers.length, 2);
  assert.equal(intersection.sharedRows.length, 2);
  assert.equal(intersection.onlyARows.length, 1);
  assert.equal(intersection.onlyARows[0].node.id, t102Id);
  assert.deepEqual([...intersection.onlyARows[0].subjects], ["Англійська мова за професійним спрямуванням"]);
  assert.deepEqual([...intersection.onlyARows[0].rooms], ["301"]);
  assert.equal(intersection.onlyBRows.length, 0);
  assert.equal(intersection.sharedSubjects.length, 1);
  assert.equal(intersection.sharedSubjects[0].id, 200);
  assert.equal(intersection.sharedRooms.length, 1);
  assert.equal(intersection.sharedRooms[0].name, "205");

  const compare = engine.computeCompareLayout(graph, intersection);
  assert.ok(compare.positions.get(g10Id).x < 0);
  assert.ok(compare.positions.get(g11Id).x > 0);
  assert.equal(Math.abs(compare.positions.get(t100Id).x), 0);
  // Compare canvas shows unique left/right difference wings alongside center shared bridge nodes
  assert.equal(compare.visibleNodeIds.has(t102Id), true);
  assert.ok(compare.positions.get(t102Id).x < compare.positions.get(g10Id).x);
  assert.ok(compare.positions.get(g10Id).subtitle.includes("Відмінних: 1"));
  assert.ok(compare.positions.get(t100Id).subtitle.includes("Алгоритми та структури даних"));
});

test("getNodeInspectorData returns curator, curated groups, and sorted relation rows with full subjects and rooms", () => {
  const engine = loadAtlasEngine();
  const graph = engine.buildAtlasGraph(makeSampleAtlasPayload());

  const g10Inspector = engine.getNodeInspectorData(graph, engine.makeAtlasNodeId("group", 10));
  assert.ok(g10Inspector);
  assert.equal(g10Inspector.curatorTeacher?.id, engine.makeAtlasNodeId("teacher", 100));
  assert.equal(g10Inspector.subjects.length, 2);
  assert.equal(g10Inspector.teachers.length, 2);
  assert.equal(g10Inspector.rooms.length, 2);
  const t100Row = g10Inspector.teachers.find((r) => r.node.id === engine.makeAtlasNodeId("teacher", 100));
  assert.ok(t100Row);
  assert.equal(t100Row.badge, "Куратор");
  assert.ok(t100Row.subjects.includes("Алгоритми та структури даних"));
  assert.ok(t100Row.rooms.includes("205"));

  const t100Inspector = engine.getNodeInspectorData(graph, engine.makeAtlasNodeId("teacher", 100));
  assert.ok(t100Inspector);
  assert.equal(t100Inspector.curatedGroups.length, 1);
  assert.equal(t100Inspector.curatedGroups[0].label, "АБ-21");
  const homeRoomRow = t100Inspector.rooms.find((r) => r.node.label === "205");
  assert.ok(homeRoomRow);
  assert.equal(homeRoomRow.badge, "Закріплена");
});

test("compactSubjectLabel prefers shortName when compact and truncates long strings", () => {
  const engine = loadAtlasEngine();
  assert.equal(engine.compactSubjectLabel("Довга назва дисципліни", "ДНД"), "ДНД");
  const truncated = engine.compactSubjectLabel("Дуже довга назва якоїсь навчальної дисципліни", null);
  assert.ok(truncated.endsWith("…"));
  assert.ok(truncated.length <= 18);
});

test("resolveTeacherEdgeRoom gives each subgroup teacher only their own room", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();
  payload.edges.push({
    group_id: 11,
    teacher_id: 101,
    second_teacher_id: 100,
    subject_id: 201,
    room: "104 / 205",
    lessons_count: 2,
    days: [3],
  });
  const graph = engine.buildAtlasGraph(payload);

  const dualEdge = payload.edges[payload.edges.length - 1];
  assert.equal(engine.resolveTeacherEdgeRoom(graph, dualEdge, 101), "104");
  assert.equal(engine.resolveTeacherEdgeRoom(graph, dualEdge, 100), "205");

  // Single edge.room ("104" from primary teacher) must not leak into second teacher's inspector rooms
  const t100Inspector = engine.getNodeInspectorData(graph, engine.makeAtlasNodeId("teacher", 100));
  assert.ok(t100Inspector);
  assert.deepEqual(
    Array.from(t100Inspector.rooms, (r) => r.node.label),
    ["205"],
  );
  const g10RowForT100 = t100Inspector.groups.find((r) => r.node.rawId === 10);
  assert.ok(g10RowForT100);
  assert.deepEqual([...g10RowForT100.rooms], ["205"]);
});

test("buildAtlasGraph and computeEgoLayout order groups sequentially by course and natural group code", () => {
  const engine = loadAtlasEngine();
  const payload = {
    summary: { groups_count: 4, teachers_count: 1, subjects_count: 1, rooms_count: 1, edges_count: 4 },
    groups: [
      { id: 4, name: "102", course: 3, faculty_id: 2, faculty_name: "А", curator_id: 100, lessons_count: 2 },
      { id: 3, name: "86", course: 2, faculty_id: 2, faculty_name: "Б", curator_id: 100, lessons_count: 2 },
      { id: 1, name: "101", course: 3, faculty_id: 1, faculty_name: "Я", curator_id: 100, lessons_count: 2 },
      { id: 2, name: "85", course: 2, faculty_id: 1, faculty_name: "В", curator_id: 100, lessons_count: 10 },
    ],
    teachers: [
      { id: 100, name: "Коваль О. І.", full_name: "Коваль Олександр Іванович", room: "205", groups_count: 4, subjects_count: 1, lessons_count: 16 },
    ],
    subjects: [
      { id: 200, name: "Інформатика", short_name: "Інф", groups_count: 4, teachers_count: 1, lessons_count: 16 },
    ],
    rooms: [{ id: "205", name: "205", floor: 2, groups_count: 4, teachers_count: 1, lessons_count: 16 }],
    edges: [
      { group_id: 4, teacher_id: 100, second_teacher_id: null, subject_id: 200, room: "205", lessons_count: 2, days: [1] },
      { group_id: 3, teacher_id: 100, second_teacher_id: null, subject_id: 200, room: "205", lessons_count: 2, days: [2] },
      { group_id: 1, teacher_id: 100, second_teacher_id: null, subject_id: 200, room: "205", lessons_count: 2, days: [3] },
      { group_id: 2, teacher_id: 100, second_teacher_id: null, subject_id: 200, room: "205", lessons_count: 10, days: [4] },
    ],
  };

  const graph = engine.buildAtlasGraph(payload);
  const groupsByAngle = [...graph.nodes]
    .filter((n) => n.kind === "group")
    .sort((a, b) => a.angle - b.angle)
    .map((n) => n.label);
  assert.deepEqual(groupsByAngle, ["85", "86", "101", "102"]);

  const teacherEgo = engine.computeEgoLayout(graph, engine.makeAtlasNodeId("teacher", 100));
  const egoGroupsByAngle = Array.from(teacherEgo.positions.entries())
    .filter(([id]) => id.startsWith("group:"))
    .map(([id, pos]) => ({ label: graph.nodeMap.get(id).label, angle: pos.angle }))
    .sort((a, b) => a.angle - b.angle)
    .map((item) => item.label);
  assert.deepEqual([...egoGroupsByAngle], ["85", "86", "101", "102"]);
});

test("sortAtlasRelationRows and filterAtlasRelationRows sort and filter by lessons, alpha, room, day, and course", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();
  payload.teachers.push({
    id: 102,
    name: "Авраменко В. П.",
    full_name: "Василь Авраменко",
    room: "310",
    groups_count: 1,
    subjects_count: 1,
    lessons_count: 1,
  });
  payload.edges.push({
    group_id: 10,
    teacher_id: 102,
    second_teacher_id: null,
    subject_id: 200,
    room: "310",
    lessons_count: 1,
    days: [2],
  });

  const graph = engine.buildAtlasGraph(payload);
  const g10Inspector = engine.getNodeInspectorData(graph, engine.makeAtlasNodeId("group", 10));
  assert.ok(g10Inspector);

  // Default order: Curator first (Коваль О. І.), then strictly alphabetical A–Z (Авраменко В. П., Бойко М. С.)
  const defaultOrder = [...g10Inspector.teachers.map((r) => r.node.label)];
  assert.deepEqual(defaultOrder, ["Коваль О. І.", "Авраменко В. П.", "Бойко М. С."]);

  const byAlpha = [...engine.sortAtlasRelationRows(g10Inspector.teachers, "alpha").map((r) => r.node.label)];
  assert.deepEqual(byAlpha, ["Авраменко В. П.", "Бойко М. С.", "Коваль О. І."]);

  const byRoom = [...engine.sortAtlasRelationRows(g10Inspector.teachers, "room").map((r) => r.rooms[0])];
  assert.deepEqual(byRoom, ["104", "205", "310"]);

  const byDay = [...engine.sortAtlasRelationRows(g10Inspector.teachers, "day").map((r) => r.node.label)];
  assert.deepEqual(byDay, ["Коваль О. І.", "Авраменко В. П.", "Бойко М. С."]);

  const filteredByRoom = engine.filterAtlasRelationRows(g10Inspector.teachers, "каб. 310");
  assert.equal(filteredByRoom.length, 1);
  assert.equal(filteredByRoom[0].node.label, "Авраменко В. П.");

  const filteredByDay = engine.filterAtlasRelationRows(g10Inspector.teachers, "п'ятниця");
  assert.ok(filteredByDay.some((r) => r.node.label === "Бойко М. С."));
});

test("getCompareCandidates returns only same-kind nodes and prioritizes same-course sister groups in natural order", () => {
  const engine = loadAtlasEngine();
  const payload = {
    summary: { groups_count: 4, teachers_count: 2, subjects_count: 1, rooms_count: 1, edges_count: 4 },
    groups: [
      { id: 1, name: "92", course: 1, faculty_id: 1, faculty_name: "КІ", curator_id: 100, lessons_count: 8 },
      { id: 2, name: "93", course: 1, faculty_id: 1, faculty_name: "КІ", curator_id: 100, lessons_count: 8 },
      { id: 3, name: "85", course: 3, faculty_id: 1, faculty_name: "КІ", curator_id: 100, lessons_count: 6 },
      { id: 4, name: "86", course: 3, faculty_id: 1, faculty_name: "КІ", curator_id: 101, lessons_count: 6 },
    ],
    teachers: [
      { id: 100, name: "Коваль О. І.", full_name: "Коваль Олександр Іванович", room: "205", groups_count: 4, subjects_count: 1, lessons_count: 16 },
      { id: 101, name: "Бойко М. С.", full_name: "Бойко Марія Сергіївна", room: "104", groups_count: 2, subjects_count: 1, lessons_count: 6 },
    ],
    subjects: [
      { id: 200, name: "Інформатика", short_name: "Інф", groups_count: 4, teachers_count: 2, lessons_count: 22 },
    ],
    rooms: [{ id: "205", name: "205", floor: 2, groups_count: 4, teachers_count: 2, lessons_count: 22 }],
    edges: [
      { group_id: 1, teacher_id: 100, second_teacher_id: null, subject_id: 200, room: "205", lessons_count: 8, days: [1] },
      { group_id: 2, teacher_id: 100, second_teacher_id: null, subject_id: 200, room: "205", lessons_count: 8, days: [2] },
      { group_id: 3, teacher_id: 100, second_teacher_id: 101, subject_id: 200, room: "205", lessons_count: 6, days: [3] },
      { group_id: 4, teacher_id: 100, second_teacher_id: 101, subject_id: 200, room: "205", lessons_count: 6, days: [4] },
    ],
  };

  const graph = engine.buildAtlasGraph(payload);
  const g85Id = engine.makeAtlasNodeId("group", 3);
  const candidates = engine.getCompareCandidates(graph, g85Id);
  assert.equal(candidates.length, 3);
  assert.ok(candidates.every((c) => c.node.kind === "group"));
  // Sister group 86 (3rd course) must be the very first candidate for group 85 (3rd course)
  assert.equal(candidates[0].node.label, "86");
  assert.equal(candidates[0].sharedCount, 2);
  assert.ok(candidates[0].reasonHint && candidates[0].reasonHint.includes("3к"));

  const course1Only = engine.getCompareCandidates(graph, g85Id, { courseFilter: 1 });
  assert.deepEqual([...course1Only.map((c) => c.node.label)], ["92", "93"]);

  const t100Id = engine.makeAtlasNodeId("teacher", 100);
  const teacherCandidates = engine.getCompareCandidates(graph, t100Id);
  assert.equal(teacherCandidates.length, 1);
  assert.ok(teacherCandidates.every((c) => c.node.kind === "teacher"));
  assert.equal(teacherCandidates[0].node.label, "Бойко М. С.");
});
