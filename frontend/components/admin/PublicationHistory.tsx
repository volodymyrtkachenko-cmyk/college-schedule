"use client";

import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import { invalidateScheduleCache } from "../../lib/hooks";
import { useToast } from "../ToastProvider";

export interface Publication {
  id: number;
  version_id: number | null;
  actor_id: number | null;
  timestamp: string;
  scope_manifest: string;
  is_reverted: boolean;
}

export const PublicationHistory: React.FC = () => {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<number | null>(null);
  const { showToast } = useToast();

  const fetchPublications = async () => {
    try {
      setLoading(true);
      const res = await api.publications.list();
      setPublications(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPublications();
  }, []);

  // Для кожної версії розкладу відкотити можна лише найостаннішу нескасовану публікацію (LIFO)
  const latestActiveIdByVersion = useMemo(() => {
    const map = new Map<number | null, number>();
    for (const p of publications) {
      if (!p.is_reverted && !map.has(p.version_id)) {
        map.set(p.version_id, p.id);
      }
    }
    return map;
  }, [publications]);

  const handleRevert = async (id: number) => {
    if (
      !window.confirm(
        "Ви дійсно хочете скасувати останню публікацію? Розклад повернеться до попереднього стану."
      )
    )
      return;
    try {
      setRevertingId(id);
      await api.publications.revert(id);
      invalidateScheduleCache();
      showToast("Публікацію успішно скасовано.", "success");
      await fetchPublications();
    } catch (e: any) {
      showToast(e instanceof Error ? e.message : "Помилка скасування публікації", "error");
    } finally {
      setRevertingId(null);
    }
  };

  return (
    <div className="mt-8 border-t border-sys-border pt-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-sys-text-primary">
            Історія публікацій (Відкат розкладу)
          </h3>
          <p className="mt-0.5 text-xs text-sys-text-muted">
            Скасувати можна поточну публікацію — розклад повернеться до стану попередньої ревізії.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-sys-text-secondary">Завантаження історії...</p>
      ) : (
        <>
          {/* Desktop Table (>=640px) */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-sys-border bg-sys-bg/30">
            <table className="min-w-full text-left text-sm text-sys-text-secondary border-collapse">
              <thead className="bg-[#111827] sticky top-0 z-10 border-b border-sys-border text-xs uppercase text-sys-text-secondary">
                <tr>
                  <th className="px-4 py-3">ID</th>
                  <th className="px-4 py-3">Дата / Час</th>
                  <th className="px-4 py-3">Версія бази</th>
                  <th className="px-4 py-3">Масштаб</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3 text-right">Дія</th>
                </tr>
              </thead>
              <tbody>
                {publications.map((p) => {
                  const scope = JSON.parse(p.scope_manifest || "{}");
                  const isLatestActive =
                    !p.is_reverted && latestActiveIdByVersion.get(p.version_id) === p.id;

                  return (
                    <tr
                      key={p.id}
                      className={`border-b border-sys-border/40 last:border-b-0 transition-colors ${
                        isLatestActive ? "bg-emerald-500/[0.03] hover:bg-emerald-500/[0.06]" : "hover:bg-white/[0.02]"
                      }`}
                    >
                      <td className="px-4 py-3 font-semibold text-sys-text-primary">#{p.id}</td>
                      <td className="px-4 py-3">
                        {new Date(p.timestamp).toLocaleString("uk-UA")}
                      </td>
                      <td className="px-4 py-3">
                        {p.version_id ? `Версія #${p.version_id}` : "Базова"}
                      </td>
                      <td className="px-4 py-3">
                        {scope.group_ids?.length ? `${scope.group_ids.length} груп` : "Всі"}
                      </td>
                      <td className="px-4 py-3">
                        {p.is_reverted ? (
                          <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                            Скасовано
                          </span>
                        ) : isLatestActive ? (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                            Поточна
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-white/5 px-2 py-0.5 text-xs font-medium text-sys-text-muted">
                            В історії
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isLatestActive ? (
                          <button
                            onClick={() => void handleRevert(p.id)}
                            disabled={revertingId === p.id}
                            className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                          >
                            {revertingId === p.id ? "Скасування..." : "Відкотити"}
                          </button>
                        ) : (
                          <span className="text-xs text-sys-text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {publications.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sys-text-muted">
                      Історія публікацій порожня
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Card View (<640px) */}
          <div className="sm:hidden space-y-2.5">
            {publications.map((p) => {
              const scope = JSON.parse(p.scope_manifest || "{}");
              const isLatestActive =
                !p.is_reverted && latestActiveIdByVersion.get(p.version_id) === p.id;

              return (
                <div key={p.id} className="rounded-xl border border-sys-border bg-sys-card p-3.5 space-y-2 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-sys-text-primary text-xs">
                      #{p.id} • {p.version_id ? `Версія #${p.version_id}` : "Базова версія"}
                    </span>
                    {p.is_reverted ? (
                      <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                        Скасовано
                      </span>
                    ) : isLatestActive ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Поточна
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-white/5 px-2 py-0.5 text-xs font-medium text-sys-text-muted">
                        В історії
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-sys-text-secondary flex items-center justify-between">
                    <span>{new Date(p.timestamp).toLocaleString("uk-UA")}</span>
                    <span>{scope.group_ids?.length ? `${scope.group_ids.length} груп` : "Всі групи"}</span>
                  </div>
                  {isLatestActive && (
                    <div className="pt-2 border-t border-sys-border/50 flex justify-end">
                      <button
                        onClick={() => void handleRevert(p.id)}
                        disabled={revertingId === p.id}
                        className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                      >
                        {revertingId === p.id ? "Скасування..." : "Відкотити публікацію"}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {publications.length === 0 && (
              <div className="py-8 text-center text-sys-text-muted text-sm rounded-xl border border-dashed border-sys-border">
                Історія публікацій порожня
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
