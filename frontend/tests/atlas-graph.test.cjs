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

test("buildAtlasGraph produces deterministic coordinates, rings, and adjacency", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();

  const graphA = engine.buildAtlasGraph(payload);
  const graphB = engine.buildAtlasGraph(payload);

  assert.equal(graphA.nodes.length, 8);
  assert.ok(graphA.rings.length >= 4);
  assert.ok(graphA.links.length > 0);

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

test("computeEgoLayout centers selected node at origin with neighbor orbits", () => {
  const engine = loadAtlasEngine();
  const graph = engine.buildAtlasGraph(makeSampleAtlasPayload());
  const centerId = engine.makeAtlasNodeId("group", 10);

  const ego = engine.computeEgoLayout(graph, centerId);
  assert.equal(ego.visibleNodeIds.has(centerId), true);

  const centerPos = ego.positions.get(centerId);
  assert.deepEqual({ x: centerPos.x, y: centerPos.y }, { x: 0, y: 0 });
  assert.ok(centerPos.radius >= 26);
  assert.ok(ego.rings.length === 1);

  for (const neighborId of graph.adjacency.get(centerId)) {
    assert.equal(ego.visibleNodeIds.has(neighborId), true);
    const nPos = ego.positions.get(neighborId);
    assert.ok(Math.hypot(nPos.x, nPos.y) > 150);
  }
});

test("computeEgoLayout splits into two rings when neighbor count exceeds 16", () => {
  const engine = loadAtlasEngine();
  const payload = makeSampleAtlasPayload();
  for (let i = 1; i <= 18; i++) {
    payload.subjects.push({
      id: 300 + i,
      name: `Предмет ${i}`,
      short_name: `П-${i}`,
      groups_count: 1,
      teachers_count: 1,
      lessons_count: 1,
    });
    payload.edges.push({
      group_id: 10,
      teacher_id: 100,
      second_teacher_id: null,
      subject_id: 300 + i,
      room: "205",
      lessons_count: 1,
      days: [1],
    });
  }

  const graph = engine.buildAtlasGraph(payload);
  const centerId = engine.makeAtlasNodeId("group", 10);
  const ego = engine.computeEgoLayout(graph, centerId);
  assert.equal(ego.rings.length, 2);
});

test("computeNodeIntersection and computeCompareLayout highlight shared bridges", () => {
  const engine = loadAtlasEngine();
  const graph = engine.buildAtlasGraph(makeSampleAtlasPayload());

  const g10Id = engine.makeAtlasNodeId("group", 10);
  const g11Id = engine.makeAtlasNodeId("group", 11);
  const t100Id = engine.makeAtlasNodeId("teacher", 100);
  const s200Id = engine.makeAtlasNodeId("subject", 200);
  const r205Id = engine.makeAtlasNodeId("room", "205");

  const intersection = engine.computeNodeIntersection(graph, g10Id, g11Id);
  assert.equal(intersection.directConnected, false);
  assert.equal(intersection.sharedNodeIds.has(t100Id), true);
  assert.equal(intersection.sharedNodeIds.has(s200Id), true);
  assert.equal(intersection.sharedNodeIds.has(r205Id), true);

  const compare = engine.computeCompareLayout(graph, intersection);
  assert.ok(compare.positions.get(g10Id).x < 0);
  assert.ok(compare.positions.get(g11Id).x > 0);
  assert.equal(Math.abs(compare.positions.get(t100Id).x), 0);
});

test("getNodeInspectorData returns curator, curated groups, and sorted relation rows", () => {
  const engine = loadAtlasEngine();
  const graph = engine.buildAtlasGraph(makeSampleAtlasPayload());

  const g10Inspector = engine.getNodeInspectorData(graph, engine.makeAtlasNodeId("group", 10));
  assert.ok(g10Inspector);
  assert.equal(g10Inspector.curatorTeacher?.id, engine.makeAtlasNodeId("teacher", 100));
  assert.equal(g10Inspector.subjects.length, 2);
  assert.equal(g10Inspector.teachers.length, 2);
  assert.equal(g10Inspector.rooms.length, 2);

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
