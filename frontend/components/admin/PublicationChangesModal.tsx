"use client";

import React, { useEffect, useMemo, useState } from "react";
import { api, PublicationChangeItem } from "../../lib/api";
import { formatPlural } from "../../lib/format";
import { useToast } from "../ToastProvider";

interface PublicationChangesModalProps {
  publicationId: number | null;
  onClose: () => void;
  onReverted?: () => void;
}

export function PublicationChangesModal({
  publicationId,
  onClose,
  onReverted,
}: PublicationChangesModalProps) {
  const [changesList, setChangesList] = useState<PublicationChangeItem[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>("all");
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (publicationId === null) {
      setChangesList([]);
      setSelectedGroup("all");
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.publications
      .changes(publicationId)
      .then((data) => {
        if (!cancelled) {
          setChangesList(data);
          setSelectedGroup("all");
        }
      })
      .catch((e: any) => {
        if (!cancelled) {
          showToast(e instanceof Error ? e.message : "Не вдалося завантажити зміни", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [publicationId, showToast]);

  // Sort changes by group name first, then date, then lesson number
  const sortedChanges = useMemo(() => {
    return [...changesList].sort((a, b) => {
      const gCmp = (a.group_name || "").localeCompare(b.group_name || "", "uk", { numeric: true });
      if (gCmp !== 0) return gCmp;
      const dCmp = (a.date || "").localeCompare(b.date || "");
      if (dCmp !== 0) return dCmp;
      return (a.lesson_number || 0) - (b.lesson_number || 0);
    });
  }, [changesList]);

  // Extract unique group names for group filter
  const groupNames = useMemo(() => {
    const set = new Set<string>();
    for (const ch of sortedChanges) {
      if (ch.group_name) set.add(ch.group_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "uk", { numeric: true }));
  }, [sortedChanges]);

  // Counts of replacements, swaps, cancellations
  const { replacementsCount, swapsCount, cancellationsCount } = useMemo(() => {
    let rep = 0;
    let sw = 0;
    let canc = 0;
    for (const ch of changesList) {
      if (ch.kind === "cancellation") {
        canc += 1;
      } else if (
        ch.is_swap ||
        ch.change_type === "swap" ||
        (ch.after && ch.after.includes("Перестановка"))
      ) {
        sw += 1;
      } else {
        rep += 1;
      }
    }
    return { replacementsCount: rep, swapsCount: sw, cancellationsCount: canc };
  }, [changesList]);

  // Filtered changes for display
  const displayChanges = useMemo(() => {
    if (selectedGroup === "all") return sortedChanges;
    return sortedChanges.filter((ch) => ch.group_name === selectedGroup);
  }, [sortedChanges, selectedGroup]);

  if (publicationId === null) return null;

  const handleRevert = async () => {
    if (
      !window.confirm(
        `Ви дійсно хочете відкотити публікацію #${publicationId}? Розклад повернеться до попереднього стану.`
      )
    ) {
      return;
    }
    setReverting(true);
    try {
      await api.publications.revert(publicationId);
      showToast(`Публікацію #${publicationId} успішно скасовано`, "success");
      onReverted?.();
      onClose();
    } catch (e: any) {
      showToast(e instanceof Error ? e.message : "Помилка відкату публікації", "error");
    } finally {
      setReverting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-4xl rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6 shadow-2xl max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="border-b border-sys-border/60 pb-4 mb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-base sm:text-lg font-bold text-sys-text-primary">
                  Зміни публікації #{publicationId}
                </h4>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-sys-accent/15 text-sys-accent font-bold border border-sys-accent/30">
                  {formatPlural(changesList.length, "зміна", "зміни", "змін")}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/30">
                  {formatPlural(replacementsCount, "заміна", "заміни", "замін")}
                </span>
                <span className="text-xs px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 font-semibold border border-indigo-500/30">
                  {formatPlural(swapsCount, "перестановка", "перестановки", "перестановок")}
                </span>
                {cancellationsCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-md bg-rose-500/15 text-rose-700 dark:text-rose-300 font-semibold border border-rose-500/30">
                    {formatPlural(cancellationsCount, "скасування", "скасування", "скасувань")}
                  </span>
                )}
              </div>
              <p className="text-xs text-sys-text-secondary mt-1">
                Відсортовано за групами. Розраховано разові заміни та перестановки пар у той же день.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-sys-text-muted hover:bg-slate-100 dark:hover:bg-white/10 hover:text-sys-text-primary transition-colors text-lg shrink-0"
              aria-label="Закрити"
            >
              ✕
            </button>
          </div>

          {/* Group filter pills when multiple groups exist */}
          {groupNames.length > 1 && (
            <div className="mt-3.5 flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-thin text-xs">
              <span className="text-[11px] font-semibold text-sys-text-muted mr-1 uppercase shrink-0">
                Група:
              </span>
              <button
                type="button"
                onClick={() => setSelectedGroup("all")}
                className={`px-2.5 py-1 rounded-lg font-medium transition-all shrink-0 ${
                  selectedGroup === "all"
                    ? "bg-sys-accent text-white font-semibold shadow-xs"
                    : "bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-sys-text-secondary border border-sys-border"
                }`}
              >
                Всі групи ({changesList.length})
              </button>
              {groupNames.map((grp) => {
                const count = changesList.filter((c) => c.group_name === grp).length;
                return (
                  <button
                    key={grp}
                    type="button"
                    onClick={() => setSelectedGroup(grp)}
                    className={`px-2.5 py-1 rounded-lg font-medium transition-all shrink-0 ${
                      selectedGroup === grp
                        ? "bg-sys-accent text-white font-semibold shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-sys-text-secondary border border-sys-border"
                    }`}
                  >
                    {grp} ({count})
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="py-12 text-center text-sm text-sys-text-secondary flex flex-col items-center justify-center gap-2">
              <span className="animate-spin text-xl">⏳</span>
              <span>Завантаження списку змін...</span>
            </div>
          ) : changesList.length === 0 ? (
            <div className="py-12 text-center text-sm text-sys-text-muted rounded-xl border border-dashed border-sys-border/60">
              Детальні зміни для цієї публікації відсутні або розклад не змінювався.
            </div>
          ) : displayChanges.length === 0 ? (
            <div className="py-8 text-center text-sm text-sys-text-muted rounded-xl border border-dashed border-sys-border/60">
              Для вибраної групи змін немає.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-sys-border bg-sys-bg/40">
              <table className="min-w-full text-left text-xs text-sys-text-secondary border-collapse">
                <thead className="bg-slate-100 dark:bg-[#111827] sticky top-0 z-10 border-b border-sys-border text-[11px] uppercase text-slate-700 dark:text-sys-text-secondary">
                  <tr>
                    <th className="px-3.5 py-2.5 font-bold">Група</th>
                    <th className="px-3.5 py-2.5">Дата</th>
                    <th className="px-3.5 py-2.5">Пара</th>
                    <th className="px-3.5 py-2.5">Тип</th>
                    <th className="px-3.5 py-2.5">Було</th>
                    <th className="px-3.5 py-2.5">Стало</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sys-border/30">
                  {displayChanges.map((ch, idx) => {
                    const isSwap =
                      ch.is_swap ||
                      ch.change_type === "swap" ||
                      (ch.after && ch.after.includes("Перестановка"));
                    const isCancellation = ch.kind === "cancellation";

                    return (
                      <tr key={idx} className="hover:bg-slate-500/5 dark:hover:bg-white/[0.02]">
                        <td className="px-3.5 py-2.5 font-bold text-sys-text-primary whitespace-nowrap bg-sys-accent/[0.03]">
                          {ch.group_name}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap text-sys-text-secondary font-mono text-[11px]">
                          {ch.date || "—"}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap font-medium text-sys-text-primary">
                          {ch.lesson_number ? `Пара ${ch.lesson_number}` : "—"}
                        </td>
                        <td className="px-3.5 py-2.5 whitespace-nowrap">
                          {isSwap ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30">
                              🔀 Перестановка
                            </span>
                          ) : isCancellation ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                              ❌ Скасовано
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                              🏷️ Заміна
                            </span>
                          )}
                        </td>
                        <td className="px-3.5 py-2.5 text-rose-700 dark:text-rose-300 font-mono text-[11px] max-w-[240px] break-words">
                          {ch.before || "—"}
                        </td>
                        <td className="px-3.5 py-2.5 text-emerald-700 dark:text-emerald-300 font-mono text-[11px] max-w-[280px] break-words">
                          {ch.after || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-4 border-t border-sys-border/60 mt-4 flex items-center justify-between gap-3">
          {onReverted ? (
            <button
              type="button"
              onClick={() => void handleRevert()}
              disabled={reverting}
              className="rounded-xl border border-rose-500/40 bg-rose-600 hover:bg-rose-700 text-white font-bold px-4 py-2 text-xs shadow-xs transition-all active:scale-95 disabled:opacity-50"
            >
              {reverting ? "Відкат..." : "Відкотити публікацію"}
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-sys-border bg-slate-100 hover:bg-slate-200 dark:bg-white/10 dark:hover:bg-white/15 px-4 py-2 text-xs font-semibold text-sys-text-primary transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}
