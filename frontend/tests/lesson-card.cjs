const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadTsModule } = require('./helpers/load-ts-module.cjs');

function createFixedDateClass(fixedIsoUtc) {
  const fixedMs = Date.parse(fixedIsoUtc);
  return class extends Date {
    constructor(...args) {
      if (args.length === 0) {
        super(fixedMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return fixedMs;
    }
  };
}

function loadLessonCardLib(fixedIsoUtc = '2026-10-12T08:30:00Z') {
  return loadTsModule(path.join(__dirname, '../lib/lesson-card/index.ts'), {
    Date: createFixedDateClass(fixedIsoUtc),
  });
}

test('kyivClock parses HH:MM, calculates Kyiv now, and formats moved-to labels', () => {
  const lib = loadLessonCardLib('2026-10-12T08:35:00Z'); // +03:00 EEST -> 11:35 Kyiv
  assert.equal(lib.parseMinutes('09:00'), 540);
  assert.equal(lib.parseMinutes('10:20'), 620);
  assert.equal(lib.parseMinutes(undefined), null);

  const now = lib.getKyivNow();
  assert.equal(now.dateIso, '2026-10-12');
  assert.equal(now.minutes, 11 * 60 + 35);

  assert.equal(lib.formatMovedTo('2026-10-13', 3), 'Перенесено → Вівторок, 3 пара');
  assert.equal(lib.formatMovedTo(null, 2), null);
});

test('taskDeadlines parses due dates across urgent, overdue, normal, and sorts accurately', () => {
  const lib = loadLessonCardLib('2026-10-12T09:00:00Z');

  const todayDue = lib.parseTaskDeadline('до 12.10');
  assert.equal(todayDue.statusText, 'Сьогодні');
  assert.equal(todayDue.badgeTone, 'urgent');
  assert.equal(todayDue.isOverdue, false);

  const overdue = lib.parseTaskDeadline('до 09.10');
  assert.equal(overdue.isOverdue, true);
  assert.equal(overdue.overdueDays, 3);
  assert.equal(overdue.badgeTone, 'overdue');
  assert.equal(lib.getTaskStatusText(overdue, true), '9 жовт. · прострочено 3 дні');
  assert.equal(lib.getTaskStatusText(overdue, false), '9 жовт. · термін минув 3 дні тому');

  const sorted = lib.sortTasksByDeadline([
    { id: 'done', deadline: lib.parseTaskDeadline('до 08.10'), state: 'TURNED_IN' },
    { id: 'future', deadline: lib.parseTaskDeadline('до 20.10'), state: 'CREATED' },
    { id: 'overdue', deadline: lib.parseTaskDeadline('до 10.10'), state: 'CREATED' },
    { id: 'today', deadline: todayDue, state: 'CREATED' },
  ]);
  assert.deepEqual(Array.from(sorted.map((item) => item.id)), ['overdue', 'today', 'future', 'done']);
  assert.equal(lib.formatTaskCount(1), '1 завдання');
  assert.equal(lib.formatTaskCount(3), '3 завдання');
  assert.equal(lib.formatTaskCount(5), '5 завдань');
});

test('taskParser extracts classroom tasks (including split lines) and cleans hidden tokens from visible notes', () => {
  const lib = loadLessonCardLib('2026-10-12T09:00:00Z');
  const note = [
    '[TASK] [Іванов І.І.] Лабораторна №2 (до 15.10) | https://classroom.google.com/c/1/a/2',
    '[TASK] Практична робота №1 (до 12.10)',
    '| https://classroom.google.com/c/1/a/3',
    '[🔒 Meet] https://meet.google.com/abc-defg-hij',
    'Meeting ID: 123 456 789',
    'Принести зошит у клітинку',
  ].join('\n');

  const tasks = lib.extractClassroomTasks(note);
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].teacher, 'Іванов І.І.');
  assert.equal(tasks[0].title, 'Лабораторна №2');
  assert.equal(tasks[1].title, 'Практична робота №1');
  assert.equal(tasks[1].deadline.statusText, 'Сьогодні');

  assert.equal(lib.getVisibleUserNote(note), 'Принести зошит у клітинку');
});

test('onlineMeetings resolves dual-teacher Zoom/Meet links by teacher surname and subgroup', () => {
  const lib = loadLessonCardLib('2026-10-12T09:00:00Z');
  const meetings = [
    { url: 'https://zoom.us/j/111', platform: 'zoom', label: 'Токарєва (1 підгр.)' },
    { url: 'https://meet.google.com/aaa-bbbb-ccc', platform: 'meet', label: 'Хочинський' },
  ];

  const [m0, m1] = lib.resolveTeacherMeetings(meetings, ['Токарєва Н.О.', 'Хочинський О.О.']);
  assert.equal(m0?.url, 'https://zoom.us/j/111');
  assert.equal(m1?.url, 'https://meet.google.com/aaa-bbbb-ccc');
  assert.ok(lib.getMeetingBtnStyle('zoom', false, 'normal').includes('sky'));
  assert.ok(lib.getMeetingBtnStyle('meet', true, 'compact').includes('emerald-600'));
});

test('dualTeacherTasks groups tasks by subgroup and orders active subgroup first', () => {
  const lib = loadLessonCardLib('2026-10-12T09:00:00Z');
  const dl = lib.parseTaskDeadline('до 15.10');
  const items = [
    { title: 'Завдання 1', teacher: 'Токарєва', label: '', url: 'https://classroom.google.com/1', deadline: dl },
    { title: 'Завдання 2', teacher: 'Хочинський', label: '', url: 'https://classroom.google.com/2', deadline: dl },
    { title: 'Загальне', teacher: null, label: '', url: 'https://classroom.google.com/3', deadline: dl },
  ];
  const secondary = [
    { name: 'Токарєва Н.О.', displayName: 'Токарєва Н.О.' },
    { name: 'Хочинський О.О.', displayName: 'Хочинський О.О.' },
  ];

  const grouped = lib.groupDualTeacherTasks(items, secondary, 2);
  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].teacher, 'Хочинський О.О. (2 підгр.)');
  assert.equal(grouped[1].teacher, 'Токарєва Н.О. (1 підгр.)');
  assert.equal(grouped[2].teacher, 'Інші завдання');
});
