import re

with open("frontend/app/page.tsx", "r") as f:
    text = f.read()

# Make sure we import getMondayOf
if "getMondayOf" not in text:
    text = text.replace('import { WelcomeScreen }', 'import { getMondayOf } from "../lib/date";\nimport { WelcomeScreen }')

# 1. weekAnchorDate init
old_init = """  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    // If it's Saturday (6) or Sunday (0), shift to next week's Monday
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    } else {
        date.setDate(date.getDate() - (day || 7) + 1);
    }
    date.setHours(12, 0, 0, 0);
    return date;
  });"""
new_init = """  const [weekAnchorDate, setWeekAnchorDate] = useState(() => {
    const date = new Date();
    const day = date.getDay();
    if (day === 0 || day === 6) {
        date.setDate(date.getDate() + (day === 0 ? 1 : 2));
    }
    return getMondayOf(date);
  });"""
text = text.replace(old_init, new_init)

# 2. isCurrentWeek
old_is_current = """  const isCurrentWeek = useMemo(() => {
    const todayAnchor = new Date();
    todayAnchor.setDate(todayAnchor.getDate() - (todayAnchor.getDay() || 7) + 1);
    todayAnchor.setHours(12, 0, 0, 0);
    return Math.abs(weekAnchorDate.getTime() - todayAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate]);"""
new_is_current = """  const isCurrentWeek = useMemo(() => {
    const todayAnchor = getMondayOf(new Date());
    return Math.abs(weekAnchorDate.getTime() - todayAnchor.getTime()) < 1000 * 60 * 60 * 24;
  }, [weekAnchorDate]);"""
text = text.replace(old_is_current, new_is_current)

# 3. resetWeek
old_reset = """  const resetWeek = () => {
    const date = new Date();
    date.setDate(date.getDate() - (date.getDay() || 7) + 1);
    date.setHours(12, 0, 0, 0);
    setWeekAnchorDate(date);
  };"""
new_reset = """  const resetWeek = () => setWeekAnchorDate(getMondayOf(new Date()));"""
text = text.replace(old_reset, new_reset)

# 4. next week button
old_next_btn = """onClick={() => {
                        const nextAnchor = new Date();
                        nextAnchor.setDate(nextAnchor.getDate() - (nextAnchor.getDay() || 7) + 1 + 7);
                        nextAnchor.setHours(12, 0, 0, 0);
                        setWeekAnchorDate(nextAnchor);
                      }}"""
new_next_btn = """onClick={() => {
                        const nextAnchor = getMondayOf(new Date());
                        nextAnchor.setDate(nextAnchor.getDate() + 7);
                        setWeekAnchorDate(nextAnchor);
                      }}"""
text = text.replace(old_next_btn, new_next_btn)

# 5. edit lesson
old_edit = """  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    const previousToday = today, previousWeek = week;
    const time = LESSON_TIMES[payload.lesson_number] ?? "09:00-10:20";
    updateLesson({ ...lesson, lesson_number: payload.lesson_number, time, subject: (payload as any).subject ?? lesson.subject, subject_name: (payload as any).subject_name ?? lesson.subject_name, teacher: (payload as any).teacher ?? null, teacher_name: (payload as any).teacher_name ?? null, room: (payload as any).room ?? null, week_type: payload.week_type });
    try { const saved = await api.lessons.update(lesson.id, payload); updateLesson(saved); setMessage("Заняття збережено."); }
    catch (e) { setToday(previousToday); setWeek(previousWeek); throw e; }
  };"""
new_edit = """  const edit = async (lesson: Lesson, date: string, payload: LessonMutation) => {
    const previousToday = today, previousWeek = week;
    const time = LESSON_TIMES[payload.lesson_number];
    if (!time) throw new Error(`Невідомий номер пари: ${payload.lesson_number}`);
    updateLesson({ ...lesson, lesson_number: payload.lesson_number, time, week_type: payload.week_type });
    try { 
        const saved = await api.lessons.update(lesson.id, payload); 
        updateLesson(saved); 
        setToast({ message: "Заняття збережено.", type: "success" }); 
    } catch (e) { 
        setToday(previousToday); setWeek(previousWeek); 
        setToast({ message: e instanceof Error ? e.message : "Помилка оновлення", type: "error" });
        throw e; 
    }
  };"""
text = text.replace(old_edit, new_edit)

# 6. create lesson
old_create = """  const create = async (payload: LessonMutation) => {
    const created = await api.lessons.create(payload); addLesson(payload.date ?? new Date().toISOString().slice(0, 10), created); setMessage("Заняття додано.");
  };"""
new_create = """  const create = async (payload: LessonMutation) => {
    try {
      const created = await api.lessons.create(payload);
      addLesson(payload.date ?? new Date().toISOString().slice(0, 10), created);
      setToast({ message: "Заняття додано.", type: "success" });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Не вдалося додати заняття.", type: "error" });
      throw e;
    }
  };"""
text = text.replace(old_create, new_create)

# 7. remove lesson
old_remove = """  const remove = async (lesson: Lesson) => {
    const previousToday = today, previousWeek = week; removeLesson(lesson.id);
    try { await api.lessons.remove(lesson.id); setMessage("Заняття видалено."); }
    catch (e) { setToday(previousToday); setWeek(previousWeek); throw e; }
  };"""
new_remove = """  const remove = async (lesson: Lesson) => {
    const previousToday = today, previousWeek = week; removeLesson(lesson.id);
    try { await api.lessons.remove(lesson.id); setToast({ message: "Заняття видалено.", type: "success" }); }
    catch (e) { 
        setToday(previousToday); setWeek(previousWeek); 
        setToast({ message: e instanceof Error ? e.message : "Помилка видалення", type: "error" });
        throw e; 
    }
  };"""
text = text.replace(old_remove, new_remove)

# 8. saveNote
old_save_note = """  const saveNote = async (lesson: Lesson, note: string, date: string) => {
    const saved = lesson.note_id
      ? await api.notes.update(lesson.note_id, { note })
      : await api.notes.create({ schedule_id: lesson.id, note_date: date, note });
    updateLesson({ ...lesson, note: saved.note, note_id: saved.id, note_date: saved.note_date });
    setMessage("Примітку збережено.");
  };"""
new_save_note = """  const saveNote = async (lesson: Lesson, note: string, date: string) => {
    try {
      const saved = lesson.note_id
        ? await api.notes.update(lesson.note_id, { note })
        : await api.notes.create({ schedule_id: lesson.id, note_date: date, note });
      updateLesson({ ...lesson, note: saved.note, note_id: saved.id, note_date: saved.note_date });
      setToast({ message: "Примітку збережено.", type: "success" });
    } catch (e) {
      setToast({ message: e instanceof Error ? e.message : "Не вдалося зберегти примітку.", type: "error" });
      throw e;
    }
  };"""
text = text.replace(old_save_note, new_save_note)

# 9. deleteNote
old_delete_note = """  const deleteNote = async (lesson: Lesson, date: string) => {
    if (lesson.note_id) await api.notes.remove(lesson.note_id);
    updateLesson({ ...lesson, note: null, note_id: null, note_date: date });
    setMessage("Примітку видалено.");
  };"""
new_delete_note = """  const deleteNote = async (lesson: Lesson, date: string) => {
    try {
      if (lesson.note_id) await api.notes.remove(lesson.note_id);
      updateLesson({ ...lesson, note: null, note_id: null, note_date: date });
      setToast({ message: "Примітку видалено.", type: "success" });
    } catch(e) {
      setToast({ message: e instanceof Error ? e.message : "Не вдалося видалити примітку.", type: "error" });
      throw e;
    }
  };"""
text = text.replace(old_delete_note, new_delete_note)


# Replace message with toast
text = text.replace('const [message, setMessage] = useState<string | null>(null);', 'const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);')

old_effect = """  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [message]);"""
new_effect = """  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);"""
text = text.replace(old_effect, new_effect)


old_msg_render = '{message && <p role="status" className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-200">{message}</p>}'
new_msg_render = """        {toast && (
          <div className={`fixed bottom-6 right-6 z-50 flex animate-in slide-in-from-bottom-5 items-center gap-2 rounded-[8px] border-[0.5px] px-4 py-3 text-sm shadow-xl ${
            toast.type === "success" 
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" 
            : "border-rose-500/30 bg-rose-500/10 text-rose-300"
          }`}>
             {toast.type === "success" 
               ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5l10 -10"/></svg>
               : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
             }
             {toast.message}
          </div>
        )}"""
text = text.replace(old_msg_render, new_msg_render)

# Accessibility on tabs (role="tablist")
old_tabs_container = '<div className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">'
new_tabs_container = '<div role="tablist" aria-label="Режим перегляду" className="flex w-full sm:w-auto rounded-lg border border-sys-border bg-sys-card p-1 text-sm relative">'
text = text.replace(old_tabs_container, new_tabs_container, 1)

old_student_tab = '<button type="button" onClick={() => startTransition(() => toggleMode(\'student\'))}'
new_student_tab = '<button role="tab" aria-selected={mode === \'student\'} type="button" onClick={() => startTransition(() => toggleMode(\'student\'))}'
text = text.replace(old_student_tab, new_student_tab)

old_teacher_tab = '<button type="button" onClick={() => startTransition(() => toggleMode(\'teacher\'))}'
new_teacher_tab = '<button role="tab" aria-selected={mode === \'teacher\'} type="button" onClick={() => startTransition(() => toggleMode(\'teacher\'))}'
text = text.replace(old_teacher_tab, new_teacher_tab)

# isPending for select
old_group_select = '<select value={groupId ?? ""} onChange='
new_group_select = '<select disabled={isPending} value={groupId ?? ""} onChange='
text = text.replace(old_group_select, new_group_select)

old_teacher_select = '<select value={teacherId ?? ""} onChange='
new_teacher_select = '<select disabled={isPending} value={teacherId ?? ""} onChange='
text = text.replace(old_teacher_select, new_teacher_select)

with open("frontend/app/page.tsx", "w") as f:
    f.write(text)
