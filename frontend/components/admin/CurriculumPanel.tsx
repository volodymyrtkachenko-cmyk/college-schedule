"use client";

import { useEffect, useState } from "react";
import {
  api,
  CurriculumRecord,
  CurriculumMutation,
  ReferenceRecord,
  AcademicTermRecord,
} from "../../lib/api";
import { ConfirmModal } from "./ConfirmModal";
import { SearchableSelect } from "../SearchableSelect";
import { SearchableMultiSelect } from "../SearchableMultiSelect";
import { useToast } from "../ToastProvider";
import { PageHeader } from "./PageHeader";
import { TermScheduleModal } from "./TermScheduleModal";

function formatGroupCount(count: number) {
  const remainder10 = count % 10;
  const remainder100 = count % 100;
  const noun = remainder10 === 1 && remainder100 !== 11
    ? "групи"
    : remainder10 >= 2 && remainder10 <= 4 && (remainder100 < 12 || remainder100 > 14)
      ? "груп"
      : "груп";
  return `${count} ${noun}`;
}

function normalizeSubjectKey(name: string) {
  return (name || "")
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[’ʼ`]/g, "'");
}

function inferCourseFromGroupName(name: string): number {
  if (!name) return 1;
  const digits = name.match(/\d+/);
  if (!digits) return 1;
  const num = parseInt(digits[0], 10);
  const first = parseInt(digits[0][0], 10);
  if (first >= 1 && first <= 4) return first;
  if (num >= 80 && num <= 89) return 4;
  if (num >= 70 && num <= 79) return 3;
  if (num >= 60 && num <= 69) return 2;
  return 1;
}

export function CurriculumPanel() {
  const [items, setItems] = useState<CurriculumRecord[]>([]);
  const [groups, setGroups] = useState<ReferenceRecord[]>([]);
  const [subjects, setSubjects] = useState<ReferenceRecord[]>([]);
  const [teachers, setTeachers] = useState<ReferenceRecord[]>([]);

  // Terms and academic calendar
  const [terms, setTerms] = useState<AcademicTermRecord[]>([]);
  const [selectedTermId, setSelectedTermId] = useState<number | null>(null);
  const [showTermModal, setShowTermModal] = useState(false);
  const [autoCalculate, setAutoCalculate] = useState(true);

  const [loading, setLoading] = useState(true);
  const [deduplicating, setDeduplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const { showToast: setToast } = useToast();

  const [editor, setEditor] = useState<Partial<CurriculumRecord> | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);
  const [itemToDelete, setItemToDelete] = useState<CurriculumRecord | null>(null);

  const selectedTerm = terms.find((t) => t.id === selectedTermId) || terms[0];

  useEffect(() => {
    async function load() {
      try {
        const session = await api.auth.ensureAuthenticated();
        const [termsList, activeTermRes, g, s, t] = await Promise.all([
          api.terms.list(),
          api.terms.active().catch(() => null),
          api.directory.groups(),
          api.directory.subjects(),
          api.directory.teachers(),
        ]);
        setTerms(termsList);
        const currentId = activeTermRes?.id ?? termsList[0]?.id ?? null;
        setSelectedTermId(currentId);

        const curr = await api.curriculums.list(
          session.access_token,
          undefined,
          undefined,
          currentId ?? undefined
        );
        setItems(curr);
        setGroups(g);
        setSubjects(s);
        setTeachers(t || []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  async function handleTermChange(termId: number) {
    setSelectedTermId(termId);
    setLoading(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const curr = await api.curriculums.list(
        session.access_token,
        undefined,
        undefined,
        termId
      );
      setItems(curr);
    } catch (e: any) {
      setToast(e.message || "Помилка завантаження предметів семестру", "error");
    } finally {
      setLoading(false);
    }
  }

  const [filterGroupId, setFilterGroupId] = useState<number | null>(null);
  const [filterTeacherId, setFilterTeacherId] = useState<number | null>(null);

  function getTheoryWeeksForCurrentEditor(groupId?: number): {
    theoryWeeks: number;
    course: number;
    practiceWeeks: number;
  } {
    const targetGroupId = groupId ?? editor?.group_id ?? selectedGroupIds[0];
    const groupObj = groups.find((g) => g.id === targetGroupId);
    const course = groupObj ? inferCourseFromGroupName(groupObj.name) : 1;
    const termObj = terms.find((t) => t.id === selectedTermId) || terms[0];
    const cs = termObj?.course_schedules?.find((s) => s.course === course);
    const theoryWeeks = cs ? cs.theory_weeks : (termObj?.total_weeks || 17);
    const practiceWeeks = cs ? cs.practice_weeks : 0;
    return { theoryWeeks: Math.max(1, theoryWeeks), course, practiceWeeks };
  }

  function handleHoursChange(hoursVal: number) {
    const hours = Math.max(0, hoursVal || 0);
    const { theoryWeeks } = getTheoryWeeksForCurrentEditor();
    if (autoCalculate && theoryWeeks > 0) {
      const pairsTotal = hours / 2.0;
      const pairs = Math.round((pairsTotal / theoryWeeks) * 2.0);
      setEditor((prev) =>
        prev
          ? {
              ...prev,
              total_hours: hours,
              pairs_per_2_weeks: hours > 0 ? Math.max(1, pairs) : 0,
            }
          : null
      );
    } else {
      setEditor((prev) => (prev ? { ...prev, total_hours: hours } : null));
    }
  }

  function handlePairsChange(pairsVal: number) {
    const pairs = Math.max(0, pairsVal || 0);
    const { theoryWeeks } = getTheoryWeeksForCurrentEditor();
    if (autoCalculate && theoryWeeks > 0) {
      const hours = Math.round((pairs / 2.0) * theoryWeeks) * 2;
      setEditor((prev) =>
        prev
          ? {
              ...prev,
              pairs_per_2_weeks: pairs,
              total_hours: hours,
            }
          : null
      );
    } else {
      setEditor((prev) => (prev ? { ...prev, pairs_per_2_weeks: pairs } : null));
    }
  }

  const duplicateCount = (() => {
    const seen = new Set<string>();
    let count = 0;
    for (const item of items) {
      const key = `${item.group.id}::${normalizeSubjectKey(item.subject.name)}`;
      if (seen.has(key) || (item.subject.name || "").includes("*")) {
        count += 1;
      }
      seen.add(key);
    }
    return count;
  })();

  async function handleDeduplicate() {
    setDeduplicating(true);
    try {
      const session = await api.auth.ensureAuthenticated();
      const res = await api.curriculums.deduplicate(session.access_token);
      const [curr, s] = await Promise.all([
        api.curriculums.list(session.access_token, undefined, undefined, selectedTermId ?? undefined),
        api.directory.subjects(),
      ]);
      setItems(curr);
      setSubjects(s);
      if (res.removed_curriculums > 0 || res.merged_subjects > 0 || res.renamed_subjects > 0) {
        setToast(
          `Очищено дублів навантаження: ${res.removed_curriculums}, об'єднано предметів: ${res.merged_subjects}.`,
          "success"
        );
      } else {
        setToast("Дублів предметів у навантаженні не знайдено.", "success");
      }
    } catch (err: any) {
      setToast(err.message || "Помилка під час очищення дублів.", "error");
    } finally {
      setDeduplicating(false);
    }
  }

  const filteredItems = items.filter((i) => {
    if (filterGroupId !== null && i.group.id !== filterGroupId) return false;
    if (
      filterTeacherId !== null &&
      i.teacher.id !== filterTeacherId &&
      i.second_teacher?.id !== filterTeacherId
    )
      return false;
    if (!searchTerm) return true;
    const q = searchTerm.toLowerCase();
    return (
      i.group.name.toLowerCase().includes(q) ||
      i.teacher.name.toLowerCase().includes(q) ||
      i.subject.name.toLowerCase().includes(q)
    );
  });

  const sortedItems = [...filteredItems].sort((a, b) => {
    const groupCompare = a.group.name.localeCompare(b.group.name, "uk", { numeric: true });
    if (groupCompare !== 0) return groupCompare;
    return a.subject.name.localeCompare(b.subject.name, "uk");
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!editor) return;

    if (!editor.id && selectedGroupIds.length === 0) {
      setToast("Оберіть хоча б одну групу для збереження навантаження.", "error");
      return;
    }
    if (!editor.subject_id || !editor.teacher_id) {
      setToast("Оберіть предмет та викладача.", "error");
      return;
    }

    try {
      const session = await api.auth.ensureAuthenticated();

      const payload: CurriculumMutation = {
        term_id: selectedTermId ?? undefined,
        group_id: editor.group_id ?? selectedGroupIds[0] ?? 0,
        subject_id: editor.subject_id,
        teacher_id: editor.teacher_id,
        second_teacher_id: editor.second_teacher_id || null,
        pairs_per_2_weeks: editor.pairs_per_2_weeks || 0,
        total_hours: editor.total_hours || 0,
        is_fixed: editor.is_fixed || false,
        is_stream: editor.is_stream || false,
        stream_id: editor.is_stream ? editor.stream_id ?? null : null,
        strict_day: editor.is_fixed ? editor.strict_day || null : null,
        strict_lesson: editor.is_fixed ? editor.strict_lesson || null : null,
        require_week: editor.require_week || null,
        allow_multiple_per_day: editor.allow_multiple_per_day || false,
      };

      if (editor.id) {
        const updated = await api.curriculums.update(editor.id, payload, session.access_token);
        setItems((curr) => curr.map((c) => (c.id === updated.id ? updated : c)));
        setToast("Навчальне навантаження оновлено.", "success");
      } else {
        const streamId = payload.is_stream ? `stream_${crypto.randomUUID()}` : null;
        const results = await Promise.allSettled(
          selectedGroupIds.map((group_id) =>
            api.curriculums.create(
              { ...payload, group_id, stream_id: streamId },
              session.access_token
            )
          )
        );
        const created = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : []
        );
        const failed = results.length - created.length;
        if (created.length) setItems((curr) => [...created, ...curr]);
        if (failed) {
          const latestItems = await api.curriculums.list(
            session.access_token,
            undefined,
            undefined,
            selectedTermId ?? undefined
          );
          setItems(latestItems);
          setToast("Частину записів не додано через конфлікти.", "error");
          return;
        }
        setToast(
          `Однакове навантаження додано для ${formatGroupCount(created.length)}.`,
          "success"
        );
      }
      setEditor(null);
    } catch (err: any) {
      setToast(err.message, "error");
    }
  }

  async function remove() {
    if (!itemToDelete) return;
    try {
      const session = await api.auth.ensureAuthenticated();
      await api.curriculums.remove(itemToDelete.id, session.access_token);
      setItems((curr) => curr.filter((c) => c.id !== itemToDelete.id));
      setToast("Навчальне навантаження видалено.", "success");
    } catch (err: any) {
      setToast(err.message, "error");
    } finally {
      setItemToDelete(null);
    }
  }

  const editorCalc = getTheoryWeeksForCurrentEditor();

  return (
    <>
      <PageHeader
        eyebrow="ПЛАНУВАННЯ ТА СЕМЕСТРИ"
        title="Навчальне навантаження"
        description="Розподіл предметів, аудиторних годин та викладачів між групами з ізоляцією семестрів"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {duplicateCount > 0 && (
              <button
                type="button"
                onClick={handleDeduplicate}
                disabled={deduplicating}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-sm font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
              >
                {deduplicating ? "Очищення…" : `Прибрати дублі предметів (${duplicateCount})`}
              </button>
            )}
            <button
              onClick={() => {
                setSelectedGroupIds([]);
                const { theoryWeeks } = getTheoryWeeksForCurrentEditor();
                const pairs = 2;
                const hours = Math.round((pairs / 2.0) * theoryWeeks) * 2;
                setEditor({
                  is_fixed: false,
                  is_stream: false,
                  pairs_per_2_weeks: pairs,
                  total_hours: hours,
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-sys-accent px-4 py-2 text-sm font-semibold text-white shadow-xs hover:opacity-95 transition-opacity"
            >
              + Додати навантаження
            </button>
          </div>
        }
      />

      {/* Term Selector & Practice Calendar Bar */}
      <div className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-sys-border bg-sys-card/70 shadow-xs backdrop-blur-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary">
            Семестр:
          </span>
          <select
            value={selectedTermId || ""}
            onChange={(e) => handleTermChange(Number(e.target.value))}
            className="rounded-lg border border-sys-border bg-sys-bg px-3 py-1.5 text-xs font-bold text-sys-text-primary focus:border-sys-accent outline-none cursor-pointer"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} {t.is_current ? "🟢 (Поточний)" : `(${t.status})`}
              </option>
            ))}
          </select>

          {selectedTerm?.status === "PLANNING" && (
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30 flex items-center gap-1">
              <span>📝</span> Режим планування (ізольовано від поточної статистики)
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowTermModal(true)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-sys-border/80 bg-sys-bg px-3 py-1.5 text-xs font-semibold text-sys-text-primary hover:border-sys-accent hover:text-sys-accent transition-all active:scale-95 shadow-2xs"
        >
          <span>📅</span> Графік процесу / Практики
        </button>
      </div>

      <div className="flex flex-col gap-3 mt-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sys-text-muted pointer-events-none">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0" />
                <path d="M21 21l-6 -6" />
              </svg>
            </span>
            <input
              type="search"
              aria-label="Пошук навчального навантаження"
              placeholder="Знайти предмет або викладача..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-control w-full py-2 pl-9 pr-4 text-sm"
            />
          </div>

          <div className="w-full sm:w-52">
            <SearchableSelect
              options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
              value={filterGroupId}
              onChange={setFilterGroupId}
              placeholder="Фільтр за групою"
              emptyLabel="Усі групи"
              ariaLabel="Фільтр за групою"
            />
          </div>

          <div className="w-full sm:w-56">
            <SearchableSelect
              options={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
              value={filterTeacherId}
              onChange={setFilterTeacherId}
              placeholder="Фільтр за викладачем"
              emptyLabel="Усі викладачі"
              ariaLabel="Фільтр за викладачем"
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="text-center space-y-2">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-sys-accent border-r-transparent align-[-0.125em]" />
            <p className="text-sm text-sys-text-muted">Завантаження навчального плану...</p>
          </div>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl border border-rose-500/20 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-sm">
          {error}
        </div>
      ) : (
        <>
          {/* Desktop Table View (>=768px) */}
          <div className="hidden md:block overflow-hidden rounded-xl border border-sys-border bg-sys-card shadow-xs mt-3">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="border-b border-sys-border bg-sys-bg/60 text-xs font-semibold text-sys-text-secondary uppercase">
                <tr>
                  <th className="px-5 py-3.5">Група</th>
                  <th className="px-5 py-3.5">Дисципліна</th>
                  <th className="px-5 py-3.5">Викладач</th>
                  <th className="px-5 py-3.5">Другий викладач</th>
                  <th className="px-5 py-3.5 text-center">Пар / 2 тиж.</th>
                  <th className="px-5 py-3.5 text-center">Годин</th>
                  <th className="px-5 py-3.5 text-center">Обмеження</th>
                  <th className="px-5 py-3.5 text-right">Дії</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-sys-border/50">
                {sortedItems.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02] transition-colors group">
                    <td className="px-5 py-3 font-semibold text-sys-accent">
                      {item.group.name}
                    </td>
                    <td className="px-5 py-3 font-medium text-sys-text-primary">
                      {item.subject.name}
                    </td>
                    <td className="px-5 py-3 text-sys-text-secondary">
                      {item.teacher.name}
                    </td>
                    <td className="px-5 py-3 text-sys-text-secondary">
                      {item.second_teacher ? item.second_teacher.name : <span className="text-sys-text-muted">—</span>}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span className="font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded text-xs">
                        {item.pairs_per_2_weeks}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-center font-medium text-sys-text-primary">
                      {item.total_hours}
                    </td>
                    <td className="px-5 py-3 text-center">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        {item.is_fixed && (
                          <span className="rounded bg-sys-input px-2 py-0.5 text-xs text-sys-text-secondary border border-sys-border/60">
                            Закріплено
                          </span>
                        )}
                        {item.is_stream && (
                          <span className="rounded bg-sys-accent/15 px-2 py-0.5 text-xs text-sys-accent border border-sys-accent/30 font-medium">
                            Потік
                          </span>
                        )}
                        {item.require_week && (
                          <span className="rounded bg-blue-500/15 px-2 py-0.5 text-xs text-blue-700 dark:text-blue-400 border border-blue-500/30">
                            {item.require_week === "numerator" ? "Чисельник" : "Знаменник"}
                          </span>
                        )}
                        {!item.is_fixed && !item.is_stream && !item.require_week && (
                          <span className="text-xs text-sys-text-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditor(item)}
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
                          title="Редагувати"
                          aria-label={`Редагувати ${item.subject.name}`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                          </svg>
                        </button>
                        <button
                          onClick={() => setItemToDelete(item)}
                          className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                          title="Видалити"
                          aria-label={`Видалити навантаження`}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {sortedItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-sys-text-secondary">
                      Нічого не знайдено за вашим запитом.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card List View (<768px) */}
          <div className="md:hidden space-y-3 mt-4">
            {sortedItems.map((item) => (
              <div key={item.id} className="rounded-xl border border-sys-border bg-sys-card p-4 space-y-2.5 shadow-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sys-accent px-2 py-0.5 bg-sys-accent/10 rounded text-xs">
                    {item.group.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    {item.is_fixed && (
                      <span className="rounded bg-sys-input px-2 py-0.5 text-xs text-sys-text-secondary border border-sys-border/60">
                        Закріплено
                      </span>
                    )}
                    {item.is_stream && (
                      <span className="rounded bg-sys-accent/15 px-2 py-0.5 text-xs text-sys-accent border border-sys-accent/30 font-medium">
                        Потік
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-sys-text-primary">{item.subject.name}</h4>
                  <p className="text-xs text-sys-text-secondary mt-0.5">
                    {item.teacher.name}
                    {item.second_teacher && ` • ${item.second_teacher.name}`}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-1 border-t border-sys-border/50 text-xs text-sys-text-muted">
                  <div>
                    <span className="text-emerald-700 dark:text-emerald-400 font-bold">{item.pairs_per_2_weeks}</span> пар/2 тиж. •{" "}
                    <span className="text-sys-text-secondary">{item.total_hours} год.</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditor(item)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 active:scale-95 transition-all"
                      title="Редагувати"
                      aria-label={`Редагувати ${item.subject.name}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => setItemToDelete(item)}
                      className="h-9 w-9 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-all"
                      title="Видалити"
                      aria-label={`Видалити ${item.subject.name}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {sortedItems.length === 0 && (
              <div className="rounded-xl border border-dashed border-sys-border p-8 text-center text-sys-text-secondary text-sm">
                Нічого не знайдено за вашим запитом.
              </div>
            )}
          </div>
        </>
      )}

      {/* Editor Modal with Auto-Calculator */}
      {editor && (
        <div
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4 backdrop-blur-sm shadow-2xl"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditor(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editor.id ? "Редагування навантаження" : "Нове навантаження"}
            className="flex max-h-[92dvh] w-full sm:max-w-2xl flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe animate-in slide-in-from-bottom-6 sm:slide-in-from-bottom-2 duration-200"
          >
            <div className="bg-gradient-to-b from-white/5 to-transparent p-5 sm:p-6 pb-4 border-b border-sys-border/50 sticky top-0 flex justify-between items-center z-10 bg-sys-card">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sys-accent/20 text-sys-accent">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
                  </svg>
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-sys-text-primary">
                    {editor.id ? "Редагування навантаження" : "Нове навантаження"}
                  </h3>
                  <p className="text-xs text-sys-text-secondary mt-0.5">
                    {selectedTerm?.name} • {editor.id ? "Змініть параметри плану для групи" : "Додайте план одразу для багатьох груп"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditor(null)}
                aria-label="Закрити"
                className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary transition-colors text-base"
              >
                ✕
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              <form id="curr-form" onSubmit={handleSave} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">
                      {editor.id ? "Група" : "Групи для цього плану"}
                    </label>
                    {editor.id ? (
                      <SearchableSelect
                        options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                        value={editor.group_id}
                        onChange={(id) => setEditor({ ...editor, group_id: id ?? undefined })}
                        placeholder="Знайти групу"
                        ariaLabel="Група"
                      />
                    ) : (
                      <SearchableMultiSelect
                        options={[...groups].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                        value={selectedGroupIds}
                        onChange={setSelectedGroupIds}
                        placeholder="Знайти групу"
                        ariaLabel="Оберіть групи для однакового навчального плану"
                      />
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">
                      Предмет
                    </label>
                    <SearchableSelect
                      options={[...subjects].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                      value={editor.subject_id}
                      onChange={(id) => setEditor({ ...editor, subject_id: id ?? undefined })}
                      placeholder="Знайти предмет"
                      ariaLabel="Предмет"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">
                      Викладач
                    </label>
                    <SearchableSelect
                      options={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                      value={editor.teacher_id}
                      onChange={(id) => setEditor({ ...editor, teacher_id: id ?? undefined })}
                      placeholder="Знайти викладача"
                      ariaLabel="Викладач"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold uppercase tracking-wider text-sys-text-secondary pl-1">
                      Другий викладач
                    </label>
                    <SearchableSelect
                      options={[...teachers].sort((a, b) => a.name.localeCompare(b.name, "uk"))}
                      value={editor.second_teacher_id}
                      onChange={(id) => setEditor({ ...editor, second_teacher_id: id })}
                      placeholder="Знайти викладача"
                      ariaLabel="Другий викладач"
                    />
                  </div>
                </div>

                {/* Two-way reactive auto-calculation */}
                <div className="p-4 rounded-xl border border-sys-border bg-sys-bg/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-sys-accent flex items-center gap-1.5">
                      <span>⚡</span> Автокалькулятор навантаження
                    </span>
                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-sys-text-secondary hover:text-sys-text-primary">
                      <input
                        type="checkbox"
                        checked={autoCalculate}
                        onChange={(e) => setAutoCalculate(e.target.checked)}
                        className="accent-sys-accent rounded h-3.5 w-3.5"
                      />
                      <span>Автоперерахунок</span>
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-sys-text-secondary pl-1">
                        Занять за 2 тижні
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="50"
                        required
                        value={editor.pairs_per_2_weeks || 0}
                        onChange={(e) => handlePairsChange(parseInt(e.target.value))}
                        className="w-full rounded-lg border border-sys-accent/50 bg-sys-card px-3 py-2.5 text-base font-black text-emerald-700 dark:text-emerald-400 text-center shadow-inner outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-sys-text-secondary pl-1">
                        Загальна к-ть годин
                      </label>
                      <input
                        type="number"
                        min="0"
                        required
                        value={editor.total_hours || 0}
                        onChange={(e) => handleHoursChange(parseInt(e.target.value))}
                        className="w-full rounded-lg border border-sys-border bg-sys-card px-3 py-2.5 text-[15px] font-bold text-sys-text-primary text-center shadow-xs outline-none focus:border-sys-accent focus:ring-1 focus:ring-sys-accent"
                      />
                    </div>
                  </div>

                  <div className="text-xs text-sys-text-muted flex items-center justify-between pt-1 border-t border-sys-border/40">
                    <span>
                      Курс: <strong className="text-sys-text-secondary">{editorCalc.course}</strong> • Теорія:{" "}
                      <strong className="text-sys-accent">{editorCalc.theoryWeeks} тиж.</strong>
                      {editorCalc.practiceWeeks > 0 && ` (${editorCalc.practiceWeeks} тиж. практики)`}
                    </span>
                    <span>1 пара = 2 год</span>
                  </div>
                </div>

                <div className="flex flex-col gap-2 bg-sys-bg p-4 rounded-xl border border-sys-border mt-2">
                  <label className="flex items-center gap-3 cursor-pointer group/chk">
                    <div className="relative flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={editor.is_fixed || false}
                        onChange={(e) => setEditor({ ...editor, is_fixed: e.target.checked })}
                        className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-card checked:bg-sys-accentSolid checked:border-sys-accentSolid transition-colors"
                      />
                      <svg className="absolute w-3.5 h-3.5 text-sys-onAccent opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12l5 5l10 -10"/>
                      </svg>
                    </div>
                    <div>
                      <span className="text-[14px] font-semibold text-sys-text-primary px-1">
                        Закріпити заняття
                      </span>
                      <p className="text-[12px] text-sys-text-muted">
                        Генератор поставить заняття у визначений день і пару.
                      </p>
                    </div>
                  </label>

                  <div className="flex gap-4 mt-2">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative flex items-center">
                        <input
                          type="checkbox"
                          checked={editor.allow_multiple_per_day || false}
                          onChange={(e) =>
                            setEditor({ ...editor, allow_multiple_per_day: e.target.checked })
                          }
                          className="peer appearance-none w-5 h-5 border border-sys-border rounded bg-sys-card checked:bg-sys-accentSolid checked:border-sys-accentSolid transition-colors"
                        />
                        <svg className="absolute inset-0 w-full h-full p-[2px] opacity-0 peer-checked:opacity-100 text-sys-onAccent pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </div>
                      <span className="text-sm font-medium text-sys-text-secondary group-hover:text-sys-text-primary transition-colors">
                        Проводити всі заняття в один день
                      </span>
                    </label>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-1">
                    <span className="text-sm font-medium text-sys-text-secondary w-auto sm:w-32 shrink-0">
                      Тип тижня:
                    </span>
                    <select
                      value={editor.require_week || ""}
                      onChange={(e) => setEditor({ ...editor, require_week: e.target.value || null })}
                      className="form-control text-sm flex-1"
                    >
                      <option value="">Без обмежень</option>
                      <option value="numerator">Тільки чисельник</option>
                      <option value="denominator">Тільки знаменник</option>
                    </select>
                  </div>

                  {editor.is_fixed && (
                    <div className="flex flex-col sm:flex-row gap-2.5 mt-2 ml-0 sm:ml-8">
                      <select
                        value={editor.strict_day || ""}
                        onChange={(e) => setEditor({ ...editor, strict_day: parseInt(e.target.value) })}
                        className="form-control text-sm flex-1"
                      >
                        <option value="" disabled>Оберіть день</option>
                        <option value="1">Понеділок</option>
                        <option value="2">Вівторок</option>
                        <option value="3">Середа</option>
                        <option value="4">Четвер</option>
                        <option value="5">П'ятниця</option>
                      </select>
                      {editor.allow_multiple_per_day ? (
                        <select
                          value={editor.strict_lesson || ""}
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              strict_lesson: e.target.value ? parseInt(e.target.value) : null,
                            })
                          }
                          className="form-control text-sm flex-1"
                        >
                          <option value="">Автоматичний підбір пар</option>
                          <option value="12">1 та 2 пари (2 пари)</option>
                          <option value="23">2 та 3 пари (2 пари)</option>
                          <option value="34">3 та 4 пари (2 пари)</option>
                          <option value="123">1, 2 та 3 пари (3 пари)</option>
                          <option value="234">2, 3 та 4 пари (3 пари)</option>
                          <option value="1234">Усі 4 пари</option>
                        </select>
                      ) : (
                        <select
                          value={editor.strict_lesson || ""}
                          onChange={(e) =>
                            setEditor({
                              ...editor,
                              strict_lesson: e.target.value ? parseInt(e.target.value) : null,
                            })
                          }
                          className="form-control text-sm flex-1"
                        >
                          <option value="" disabled>Оберіть пару</option>
                          <option value="1">1 пара</option>
                          <option value="2">2 пара</option>
                          <option value="3">3 пара</option>
                          <option value="4">4 пара</option>
                        </select>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="is_stream"
                    checked={editor.is_stream || false}
                    onChange={(e) => setEditor({ ...editor, is_stream: e.target.checked })}
                    className="accent-sys-accent rounded"
                  />
                  <label htmlFor="is_stream" className="text-sm font-medium text-sys-text-secondary cursor-pointer">
                    Потокове заняття (декілька груп одночасно)
                  </label>
                </div>

                <div className="pt-4 flex justify-end gap-3 border-t border-sys-border">
                  <button
                    type="button"
                    onClick={() => setEditor(null)}
                    className="px-4 py-2 border border-sys-border rounded-xl text-sm font-medium hover:bg-slate-100 dark:hover:bg-white/5 transition-colors"
                  >
                    Скасувати
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-sys-accent text-white rounded-xl text-sm font-bold shadow-md hover:bg-sys-accent-hover transition-colors"
                  >
                    Зберегти
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Term Schedule Modal */}
      {showTermModal && selectedTerm && (
        <TermScheduleModal
          term={selectedTerm}
          terms={terms}
          onClose={() => setShowTermModal(false)}
          onSaved={(updatedTerm) => {
            setTerms((prev) => prev.map((t) => (t.id === updatedTerm.id ? updatedTerm : t)));
            handleTermChange(updatedTerm.id);
          }}
          onCreatedNextTerm={(newTerm) => {
            setTerms((prev) => [newTerm, ...prev]);
            handleTermChange(newTerm.id);
          }}
        />
      )}

      <ConfirmModal
        isOpen={Boolean(itemToDelete)}
        title="Видалити навчальне навантаження?"
        message={
          itemToDelete
            ? `Ви впевнені, що хочете видалити «${itemToDelete.subject.name}» для групи «${itemToDelete.group.name}»?`
            : ""
        }
        onConfirm={remove}
        onCancel={() => setItemToDelete(null)}
      />
    </>
  );
}
