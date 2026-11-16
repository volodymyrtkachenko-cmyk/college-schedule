const test = require("node:test");
const assert = require("node:assert/strict");
const { loadTsModule } = require("./helpers/load-ts-module.cjs");

test("aggregateClassroomTasks propagates brief, deliverable, clickable materials, and maxPoints onto FullTaskItem", () => {
  const agg = loadTsModule("lib/schedule/tasksAggregation.ts");

  const items = agg.aggregateClassroomTasks({
    mode: "student",
    week: [],
    classroomTasks: [
      {
        id: "cw-10",
        title: "Практична №2",
        subject: "Бази даних",
        url: "https://classroom.google.com/c/10/a/10/details",
        due_date: "2026-11-20",
        max_points: 12,
        brief: {
          summary: "Спроєктувати схему БД та написати SQL-запити.",
          deliverable: "SQL-скрипт (.sql) або PDF зі скриншотами",
          materials: [
            { title: "Методичка.pdf", url: "https://drive.google.com/file/d/abc/view", kind: "pdf" },
          ],
          steps: [],
          estimated_minutes: 40,
          work_format: "pc",
          source: "gemini",
        },
      },
    ],
    isLinked: false,
    submissions: {},
    personalTeachers: [],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].maxPoints, 12);
  assert.deepEqual(JSON.parse(JSON.stringify(items[0].brief)), {
    summary: "Спроєктувати схему БД та написати SQL-запити.",
    deliverable: "SQL-скрипт (.sql) або PDF зі скриншотами",
    steps: [],
    materials: [
      { title: "Методичка.pdf", url: "https://drive.google.com/file/d/abc/view", kind: "pdf" },
    ],
    estimatedMinutes: 40,
    workFormat: "pc",
    source: "gemini",
  });
});

test("deriveClientTaskBrief never invents random minutes or boilerplate for bare tasks", () => {
  const nav = loadTsModule("lib/schedule/priorityNavigator.ts");

  const bare = nav.deriveClientTaskBrief({ title: "Практична робота №4", maxPoints: 12 });
  assert.equal(bare.estimatedMinutes, null);
  assert.equal(bare.summary, "");
  assert.equal(bare.deliverable, null);
  assert.deepEqual(JSON.parse(JSON.stringify(bare.steps)), []);
  assert.equal(nav.hasExpandableBrief(bare), false);
  assert.equal(nav.formatBriefChipLabel(bare), null);

  const explicit = nav.deriveClientTaskBrief({ title: "Тест (15 хв)", maxPoints: 5 });
  assert.equal(explicit.estimatedMinutes, 15);
  assert.equal(explicit.workFormat, "phone");

  const withMats = nav.normalizeTaskBrief({
    summary: "",
    steps: [],
    materials: ["Файл: Методичка.pdf"],
    estimated_minutes: null,
    work_format: "pc",
    source: "heuristic",
  });
  assert.equal(nav.hasExpandableBrief(withMats), true);
  assert.equal(nav.formatBriefChipLabel(withMats), "1 файл");
  assert.deepEqual(JSON.parse(JSON.stringify(withMats.materials)), [
    { title: "Методичка.pdf", url: null, kind: "pdf" },
  ]);
});

test("normalizeTaskBrief handles deliverable, clickable material kinds, safe http URLs, and weight formatting", () => {
  const nav = loadTsModule("lib/schedule/priorityNavigator.ts");

  const normalized = nav.normalizeTaskBrief({
    summary: "Виконати завдання за варіантом 3.",
    deliverable: "Google Форма + файл звіту",
    materials: [
      { title: "Лекція 5.docx", url: "https://docs.google.com/document/d/123/edit", kind: "doc" },
      { title: "Таблиця даних", url: "https://docs.google.com/spreadsheets/d/456/edit", kind: "sheet" },
      { title: "Небезпечне посилання", url: "javascript:alert(1)", kind: "link" },
      { title: "Лекція 5.docx", url: "https://docs.google.com/document/d/123/edit", kind: "doc" },
    ],
    estimated_minutes: 25,
    work_format: "pc",
    source: "gemini",
  });

  assert.equal(normalized.deliverable, "Google Форма + файл звіту");
  assert.equal(normalized.materials.length, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.materials)), [
    { title: "Лекція 5.docx", url: "https://docs.google.com/document/d/123/edit", kind: "doc" },
    { title: "Таблиця даних", url: "https://docs.google.com/spreadsheets/d/456/edit", kind: "sheet" },
    { title: "Небезпечне посилання", url: null, kind: "link" },
  ]);
  assert.equal(nav.hasExpandableBrief(normalized), true);
  assert.equal(nav.formatBriefChipLabel(normalized), "~25 хв · 3 файли");
  assert.equal(nav.formatMaterialKindLabel("sheet"), "Таблиця");
  assert.equal(nav.formatMaterialCount(1), "1 файл");
  assert.equal(nav.formatMaterialCount(2), "2 файли");
  assert.equal(nav.formatMaterialCount(5), "5 файлів");

  const deliverableOnly = nav.normalizeTaskBrief({
    summary: "",
    deliverable: "Пройти тест у Google Form",
    materials: [],
    source: "heuristic",
  });
  assert.equal(nav.hasExpandableBrief(deliverableOnly), true);
  assert.equal(nav.formatBriefChipLabel(deliverableOnly), "Міні-бриф");

  assert.deepEqual(JSON.parse(JSON.stringify(nav.formatTaskWeightBadge(12, "12"))), {
    label: "12 б.",
    isHeavy: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(nav.formatTaskWeightBadge(2, "5"))), {
    label: "2 б.",
    isHeavy: false,
  });
});
