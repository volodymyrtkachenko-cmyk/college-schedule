"use client";

import React, { useEffect, useState } from "react";
import { api, PublicationChangeItem } from "../../lib/api";
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
  const [loading, setLoading] = useState(false);
  const [reverting, setReverting] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (publicationId === null) {
      setChangesList([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.publications
      .changes(publicationId)
      .then((data) => {
        if (!cancelled) setChangesList(data);
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
      <div className="w-full max-w-3xl rounded-2xl border border-sys-border bg-sys-card p-5 sm:p-6 shadow-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-sys-border/60 pb-4 mb-4">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-base font-bold text-sys-text-primary">
                Зміни публікації #{publicationId}
              </h4>
              <span className="text-xs px-2 py-0.5 rounded-full bg-sys-accent/15 text-sys-accent font-semibold border border-sys-accent/30">
                {changesList.length} змін
              </span>
            </div>
            <p className="text-xs text-sys-text-muted mt-0.5">
              Список разових змін розкладу: група, дата, пара, що було → що стало
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-sys-text-muted hover:bg-white/10 hover:text-sys-text-primary transition-colors text-lg"
            aria-label="Закрити"
          >
            ✕
          </button>
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
          ) : (
            <div className="overflow-x-auto rounded-xl border border-sys-border bg-sys-bg/40">
              <table className="min-w-full text-left text-xs text-sys-text-secondary border-collapse">
                <thead className="bg-slate-100 dark:bg-[#111827] sticky top-0 z-10 border-b border-sys-border text-[11px] uppercase text-slate-700 dark:text-sys-text-secondary">
                  <tr>
                    <th className="px-3.5 py-2.5">Група</th>
                    <th className="px-3.5 py-2.5">Дата</th>
                    <th className="px-3.5 py-2.5">Пара</th>
                    <th className="px-3.5 py-2.5">Тип</th>
                    <th className="px-3.5 py-2.5">Було</th>
                    <th className="px-3.5 py-2.5">Стало</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sys-border/30">
                  {changesList.map((ch, idx) => (
                    <tr key={idx} className="hover:bg-white/[0.02]">
                      <td className="px-3.5 py-2.5 font-medium text-sys-text-primary whitespace-nowrap">
                        {ch.group_name}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap text-sys-text-secondary">
                        {ch.date}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        Пара {ch.lesson_number}
                      </td>
                      <td className="px-3.5 py-2.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            ch.kind === "cancellation"
                              ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                              : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
                          }`}
                        >
                          {ch.kind === "cancellation" ? "Скасовано" : "Заміна"}
                        </span>
                      </td>
                      <td className="px-3.5 py-2.5 text-rose-300/90 font-mono text-[11px]">
                        {ch.before || "—"}
                      </td>
                      <td className="px-3.5 py-2.5 text-emerald-300 font-mono text-[11px]">
                        {ch.after || "—"}
                      </td>
                    </tr>
                  ))}
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
              className="rounded-xl border border-rose-500/30 bg-rose-500/15 px-3.5 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors disabled:opacity-50"
            >
              {reverting ? "Відкат..." : "Відкотити публікацію"}
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-sys-border bg-white/10 px-4 py-2 text-xs font-semibold text-sys-text-primary hover:bg-white/15 transition-colors"
          >
            Закрити
          </button>
        </div>
      </div>
    </div>
  );
}
