"use client";

import { ReferenceRecord, ReferenceResource } from "../../lib/api";
import { referenceLabels } from "./AdminNav";

function EditIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function ReferenceTable({
  resource,
  items,
  faculties = [],
  teachers = [],
  loading,
  error,
  onEdit,
  onDelete,
  onOpenRoster,
}: {
  resource: ReferenceResource;
  items: ReferenceRecord[];
  faculties?: ReferenceRecord[];
  teachers?: ReferenceRecord[];
  loading: boolean;
  error: string | null;
  onEdit?: (item: ReferenceRecord) => void;
  onDelete?: (item: ReferenceRecord) => void;
  onOpenRoster?: (group: { id: number; name: string }) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-sys-border bg-sys-card p-12 text-center text-sys-text-secondary">
        Завантаження записів…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-rose-400">
        {error}
      </div>
    );
  }

  const facultyNames = new Map(faculties.map((f) => [f.id, f.name]));
  const teacherNames = new Map(teachers.map((t) => [t.id, t.name]));

  return (
    <div className="w-full max-w-[960px]">
      {/* Desktop & Tablet Table (>= 640px) */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-sys-border bg-sys-card/50">
        <table className="w-full text-left text-sm border-collapse">
          <caption className="sr-only">{referenceLabels[resource]}</caption>
          <thead className="bg-slate-100 dark:bg-[#111827] sticky top-0 z-10 border-b border-sys-border text-xs uppercase tracking-wider text-slate-700 dark:text-sys-text-secondary">
            <tr>
              <th scope="col" className="px-5 py-3.5 font-semibold">Назва</th>
              {resource === "groups" && (
                <>
                  <th scope="col" className="px-5 py-3.5 font-semibold">Спеціальність</th>
                  <th scope="col" className="px-5 py-3.5 font-semibold">Куратор</th>
                </>
              )}
              {resource === "teachers" && <th scope="col" className="px-5 py-3.5 font-semibold">Аудиторія</th>}
              <th scope="col" className="px-5 py-3.5 text-right font-semibold min-w-[120px]">Дії</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-sys-border/50">
            {items.map((item) => (
              <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors">
                <td className="px-5 py-3.5 font-medium text-sys-text-primary">
                  {resource === "groups" ? (
                    <span className="inline-block px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-white/5 border border-sys-border/60 text-sys-text-primary font-semibold">
                      {item.name}
                    </span>
                  ) : (
                    <span>{item.name}</span>
                  )}
                  {resource === "teachers" && item.full_name && (
                    <span className="block text-xs text-sys-text-secondary mt-0.5">
                      {item.full_name} {item.email ? `(${item.email})` : ""}
                    </span>
                  )}
                </td>

                {resource === "groups" && (
                  <>
                    <td className="px-5 py-3.5 text-sys-text-secondary">
                      {item.faculty_id ? facultyNames.get(item.faculty_id) ?? "Невідома спеціальність" : "—"}
                    </td>
                    <td className="px-5 py-3.5 text-sys-text-secondary">
                      {item.curator_id ? teacherNames.get(item.curator_id) ?? "Невідомий куратор" : "—"}
                    </td>
                  </>
                )}

                {resource === "teachers" && (
                  <td className="px-5 py-3.5 text-sys-text-secondary">
                    {item.room ? (
                      <span className="inline-block px-2 py-0.5 rounded bg-sys-input border border-sys-border/40 text-xs">
                        {item.room}
                      </span>
                    ) : "—"}
                  </td>
                )}

                <td className="px-5 py-3.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {resource === "groups" && onOpenRoster && (
                      <button
                        type="button"
                        onClick={() => onOpenRoster({ id: item.id, name: item.name })}
                        className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 mr-1"
                      >
                        👥 Студенти
                      </button>
                    )}
                    {onEdit && (
                      <button
                        type="button"
                        aria-label={`Редагувати ${item.name}`}
                        title="Редагувати"
                        onClick={() => onEdit(item)}
                        className="w-10 h-10 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-accent hover:bg-sys-accent/10 transition-colors"
                      >
                        <EditIcon />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        aria-label={`Видалити ${item.name}`}
                        title="Видалити"
                        onClick={() => onDelete(item)}
                        className="w-10 h-10 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <TrashIcon />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!items.length && (
              <tr>
                <td colSpan={resource === "groups" ? 4 : 3} className="px-5 py-10 text-center text-sys-text-secondary">
                  Записів не знайдено.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Card List (< 640px) */}
      <div className="sm:hidden space-y-3 pb-20">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-xl border border-sys-border bg-sys-card p-4 shadow-xs space-y-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {resource === "groups" ? (
                  <span className="inline-block px-2.5 py-1 rounded-md bg-white/5 border border-sys-border/60 text-sys-text-primary font-bold text-base">
                    {item.name}
                  </span>
                ) : (
                  <h3 className="text-base font-bold text-sys-text-primary break-words">
                    {item.name}
                  </h3>
                )}
                {resource === "teachers" && item.full_name && (
                  <p className="text-xs text-sys-text-secondary mt-1">
                    {item.full_name} {item.email ? `(${item.email})` : ""}
                  </p>
                )}
              </div>

              {/* Horizontal actions 44x44 */}
              <div className="flex items-center gap-1 shrink-0">
                {onEdit && (
                  <button
                    type="button"
                    aria-label={`Редагувати ${item.name}`}
                    onClick={() => onEdit(item)}
                    className="w-11 h-11 flex items-center justify-center rounded-lg border border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-accent active:bg-sys-accent/15"
                  >
                    <EditIcon />
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    aria-label={`Видалити ${item.name}`}
                    onClick={() => onDelete(item)}
                    className="w-11 h-11 flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-400 active:bg-rose-500/20"
                  >
                    <TrashIcon />
                  </button>
                )}
              </div>
            </div>

            {resource === "groups" && (
              <div className="flex flex-col gap-1 text-xs text-sys-text-secondary pt-1 border-t border-sys-border/40">
                <div>
                  <span className="text-sys-text-muted">Спеціальність: </span>
                  <span className="text-sys-text-primary font-medium">
                    {item.faculty_id ? facultyNames.get(item.faculty_id) ?? "—" : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-sys-text-muted">Куратор: </span>
                  <span className="text-sys-text-primary font-medium">
                    {item.curator_id ? teacherNames.get(item.curator_id) ?? "—" : "—"}
                  </span>
                </div>
                {onOpenRoster && (
                  <button
                    type="button"
                    onClick={() => onOpenRoster({ id: item.id, name: item.name })}
                    className="mt-2 w-full flex items-center justify-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 py-2.5 text-xs font-semibold text-sky-300 active:bg-sky-500/20"
                  >
                    👥 Студенти групи
                  </button>
                )}
              </div>
            )}

            {resource === "teachers" && item.room && (
              <div className="text-xs pt-1 border-t border-sys-border/40">
                <span className="text-sys-text-muted">Аудиторія: </span>
                <span className="font-semibold text-sys-text-primary">{item.room}</span>
              </div>
            )}
          </article>
        ))}

        {!items.length && (
          <div className="rounded-xl border border-dashed border-sys-border p-8 text-center text-sys-text-secondary text-sm">
            Записів не знайдено.
          </div>
        )}
      </div>
    </div>
  );
}