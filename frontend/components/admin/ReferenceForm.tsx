"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SearchableSelect } from "../SearchableSelect";
import { ReferenceMutation, ReferenceRecord, ReferenceResource } from "../../lib/api";

type Props = {
  resource: ReferenceResource;
  item?: ReferenceRecord;
  faculties?: ReferenceRecord[];
  teachers?: ReferenceRecord[];
  onCancel: () => void;
  onSubmit: (value: ReferenceMutation) => Promise<void>;
};

const fields: Record<ReferenceResource, { key: keyof ReferenceMutation; label: string; type?: string }[]> = {
  faculties: [
    { key: "name", label: "Назва" },
    { key: "short_name", label: "Скорочення" },
  ],
  groups: [
    { key: "name", label: "Назва" },
    { key: "year_of_admission", label: "Рік вступу (напр. 2024)", type: "number" },
  ],
  teachers: [
    { key: "name", label: "Скорочене ім’я (для розкладу)" },
    { key: "full_name", label: "Повне ім’я (ПІБ з Classroom)" },
    { key: "email", label: "Email" },
    { key: "room", label: "Аудиторія (постійна)" },
  ],
  subjects: [{ key: "name", label: "Назва" }],
};

export function ReferenceForm({
  resource,
  item,
  faculties = [],
  teachers = [],
  onCancel,
  onSubmit,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const shouldReduceMotion = useReducedMotion();
  const [value, setValue] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extraKeys = resource === "groups" ? ["faculty_id", "curator_id"] : [];

  useEffect(() => {
    setValue(
      Object.fromEntries(
        [...fields[resource], ...extraKeys.map((k) => ({ key: k as keyof ReferenceMutation }))].map(
          ({ key }) => [key, item?.[key] == null ? "" : String(item[key])]
        )
      )
    );
    setTimeout(() => inputRef.current?.focus(), 120);
  }, [resource, item]);

  // Handle escape to close
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onCancel]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = Object.fromEntries(
        [...fields[resource], ...extraKeys.map((k) => ({ key: k as keyof ReferenceMutation, type: "number" }))].map(
          ({ key, type }) => [
            key,
            type === "number"
              ? value[key]
                ? Number(value[key])
                : null
              : value[key]?.trim() || null,
          ]
        )
      ) as unknown as ReferenceMutation;
      if (!payload.name) throw new Error("Вкажіть назву.");
      await onSubmit(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <motion.form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-form-title"
        initial={shouldReduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
        exit={shouldReduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
        className="flex max-h-[92dvh] w-full max-w-[420px] flex-col rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl overflow-hidden pb-safe"
      >
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-sys-border/50 bg-sys-card px-5 py-4">
          <h2 id="reference-form-title" className="text-lg font-bold text-sys-text-primary">
            {item ? "Редагування запису" : "Новий запис"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Закрити"
            className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Form Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {fields[resource].map(({ key, label, type }, i) => (
            <label key={key} className="flex flex-col gap-1.5 text-sm font-medium text-sys-text-secondary">
              <span>{label}</span>
              <input
                ref={i === 0 ? inputRef : null}
                required={key === "name"}
                type={type ?? "text"}
                value={value[key] ?? ""}
                onChange={(e) => setValue({ ...value, [key]: e.target.value })}
                className="form-control min-h-[44px] text-base sm:text-sm text-sys-text-primary"
              />
            </label>
          ))}

          {resource === "groups" && (
            <>
              <div className="flex flex-col gap-1.5 text-sm font-medium text-sys-text-secondary">
                <span>Спеціальність</span>
                <SearchableSelect
                  options={faculties}
                  value={value.faculty_id ? Number(value.faculty_id) : null}
                  onChange={(id) => setValue({ ...value, faculty_id: id ? String(id) : "" })}
                  placeholder="Без спеціальності"
                  ariaLabel="Спеціальність"
                />
              </div>

              <div className="flex flex-col gap-1.5 text-sm font-medium text-sys-text-secondary">
                <span>Куратор групи</span>
                <SearchableSelect
                  options={teachers}
                  value={value.curator_id ? Number(value.curator_id) : null}
                  onChange={(id) => setValue({ ...value, curator_id: id ? String(id) : "" })}
                  placeholder="Оберіть куратора..."
                  emptyLabel="Без куратора"
                  ariaLabel="Куратор групи"
                />
              </div>
            </>
          )}

          {error && (
            <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-400">
              {error}
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        <div className="sticky bottom-0 z-10 flex flex-col-reverse sm:flex-row sm:justify-end gap-2.5 border-t border-sys-border/50 bg-sys-bg/60 p-4 backdrop-blur-xs">
          <button
            type="button"
            onClick={onCancel}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] px-4 rounded-lg border border-sys-border bg-sys-card text-sm font-semibold text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 active:scale-[0.98] transition-all"
          >
            Скасувати
          </button>
          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto min-h-[44px] sm:min-h-[40px] px-6 rounded-lg bg-sys-accent text-sm font-semibold text-white shadow-xs hover:opacity-95 active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {saving ? "Збереження…" : "Зберегти"}
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
}