"use client";

import React, { useEffect, useMemo, useState } from "react";
import { api, PublicationChangeItem } from "../../lib/api";
import { invalidateScheduleCache } from "../../lib/hooks";
import { useToast } from "../ToastProvider";
import { PublicationChangesModal } from "./PublicationChangesModal";

export interface Publication {
  id: number;
  version_id: number | null;
  actor_id: number | null;
  timestamp: string;
  scope_manifest: string;
  is_reverted: boolean;
  source: string;
  changes_count: number;
}

export const PublicationHistory: React.FC = () => {
  const [publications, setPublications] = useState<Publication[]>([]);
  const [loading, setLoading] = useState(false);
  const [revertingId, setRevertingId] = useState<number | null>(null);
  const [selectedPublicationId, setSelectedPublicationId] = useState<number | null>(null);
  const [changesList, setChangesList] = useState<PublicationChangeItem[]>([]);
  const [loadingChanges, setLoadingChanges] = useState(false);
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

  const handleViewChanges = async (id: number) => {
    try {
      setSelectedPublicationId(id);
      setLoadingChanges(true);
      const changes = await api.publications.changes(id);
      setChangesList(changes);
    } catch (e: any) {
      showToast(e instanceof Error ? e.message : "Не вдалося завантажити зміни", "error");
    } finally {
      setLoadingChanges(false);
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
                  <th className="px-4 py-3">Джерело</th>
                  <th className="px-4 py-3">Зміни</th>
                  <th className="px-4 py-3">Версія бази</th>
                  <th className="px-4 py-3">Статус</th>
                  <th className="px-4 py-3 text-right">Дії</th>
                </tr>
              </thead>
              <tbody>
                {publications.map((p) => {
                  const isLatestActive =
                    !p.is_reverted && latestActiveIdByVersion.get(p.version_id) === p.id;
                  const isAuto = p.source === "auto" || p.source === "Авто";

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
                        {isAuto ? (
                          <span className="inline-flex items-center rounded-md bg-blue-500/15 px-2 py-0.5 text-xs font-semibold text-blue-400">
                            Авто
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
                            Вручну
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-medium text-sys-text-primary">
                        {p.changes_count || 0}
                      </td>
                      <td className="px-4 py-3">
                        {p.version_id ? `Версія #${p.version_id}` : "Базова"}
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
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => void handleViewChanges(p.id)}
                            className="rounded-lg border border-sys-border bg-white/5 px-2.5 py-1.5 text-xs font-medium text-sys-text-secondary transition-colors hover:bg-white/10 hover:text-sys-text-primary"
                          >
                            Показати зміни
                          </button>
                          {isLatestActive && (
                            <button
                              onClick={() => void handleRevert(p.id)}
                              disabled={revertingId === p.id}
                              className="rounded-lg border border-rose-500/30 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
                            >
                              {revertingId === p.id ? "Скасування..." : "Відкотити"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {publications.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-sys-text-muted">
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
              const isLatestActive =
                !p.is_reverted && latestActiveIdByVersion.get(p.version_id) === p.id;
              const isAuto = p.source === "auto" || p.source === "Авто";

              return (
                <div key={p.id} className="relative rounded-xl border border-sys-border bg-sys-card p-3.5 space-y-2.5 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="font-semibold text-sys-text-primary text-xs">
                        #{p.id} • {p.version_id ? `Версія #${p.version_id}` : "Базова"}
                      </span>
                      <div className="text-[11px] text-sys-text-muted mt-0.5">
                        {new Date(p.timestamp).toLocaleString("uk-UA")} • {p.changes_count || 0} змін
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isAuto ? (
                        <span className="inline-flex items-center rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-blue-400">
                          Авто
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-amber-400">
                          Вручну
                        </span>
                      )}
                      {p.is_reverted ? (
                        <span className="inline-flex items-center rounded-md bg-rose-500/10 px-2 py-0.5 text-xs font-medium text-rose-400">
                          Скасовано
                        </span>
                      ) : isLatestActive ? (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Поточна
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-md bg-white/5 px-2 py-0.5 text-xs font-medium text-sys-text-muted">
                          В історії
                        </span>
                      )}
                      {isLatestActive && (
                        <button
                          type="button"
                          onClick={() => void handleRevert(p.id)}
                          disabled={revertingId === p.id}
                          title="Відкотити публікацію"
                          aria-label="Відкотити публікацію"
                          className="w-9 h-9 flex items-center justify-center rounded-lg text-rose-400 hover:bg-rose-500/15 active:bg-rose-500/25 transition-colors disabled:opacity-50"
                        >
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-sys-border/50">
                    <button
                      onClick={() => void handleViewChanges(p.id)}
                      className="w-full min-h-[44px] flex items-center justify-center rounded-lg border border-sys-border bg-white/5 px-4 py-2 text-xs font-semibold text-sys-text-primary transition-colors hover:bg-white/10 active:scale-[0.98]"
                    >
                      Показати зміни
                    </button>
                  </div>
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

      {/* Changes Modal Dialog */}
      <PublicationChangesModal
        publicationId={selectedPublicationId}
        onClose={() => setSelectedPublicationId(null)}
        onReverted={fetchPublications}
      />
    </div>
  );
};

