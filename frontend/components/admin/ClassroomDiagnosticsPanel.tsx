"use client";

import React, { useCallback, useEffect, useId, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type {
  ClassroomCredentialsDiagnosticsResponse,
  ClassroomDiagnosticsCredential,
} from "../../lib/api/types";

interface ClassroomDiagnosticsPanelProps {
  onNotify?: (message: string, tone: "positive" | "negative") => void;
}

const REASON_LABELS: Record<string, string> = {
  key_changed: "Ключ шифрування змінився",
  revoked: "Токен відкликано (invalid_grant / 401)",
  missing_scopes: "Немає прав доступу Google Classroom (403)",
  no_refresh_token: "Відсутній refresh_token",
  token_refresh_failed: "Помилка оновлення токена",
};

function formatDateTime(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isProblematicCredential(c: ClassroomDiagnosticsCredential): boolean {
  return (
    !c.is_active ||
    c.needs_relink ||
    Boolean(c.last_error) ||
    !c.token_format_valid ||
    (c.token_status !== "ok:key_0" && !c.token_status.startsWith("ok:"))
  );
}

function buildSafeDiagnosticsExport(data: ClassroomCredentialsDiagnosticsResponse) {
  return {
    exported_at: new Date().toISOString(),
    primary_key_configured: data.primary_key_configured,
    encryption_key_source: data.encryption_key_source ?? null,
    total_credentials: data.total_credentials,
    active_credentials: data.active_credentials ?? null,
    needs_relink_credentials: data.needs_relink_credentials ?? null,
    error_summary: data.error_summary ?? null,
    worker_heartbeat: data.worker_heartbeat ?? null,
    group_backoffs: data.group_backoffs ?? {},
    credentials: data.credentials.map((c) => ({
      id: c.id,
      group_id: c.group_id,
      group_name: c.group_name ?? null,
      subgroup: c.subgroup ?? null,
      is_active: c.is_active,
      needs_relink: c.needs_relink,
      fail_count: c.fail_count,
      token_status: c.token_status,
      token_format_valid: c.token_format_valid,
      reason_code: c.reason_code ?? null,
      last_error: c.last_error ?? null,
      next_attempt_at: c.next_attempt_at ?? null,
      last_synced_at: c.last_synced_at ?? null,
      last_refresh_ok_at: c.last_refresh_ok_at ?? null,
      last_client_seen_at: c.last_client_seen_at ?? null,
      granted_scopes: c.granted_scopes ?? null,
    })),
  };
}

function renderTokenBadge(cred: ClassroomDiagnosticsCredential) {
  const status = cred.token_status || "unknown";
  if (status === "ok:key_0" && cred.token_format_valid) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
        {status}
      </span>
    );
  }
  if (status.startsWith("ok:") && cred.token_format_valid) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300">
        {status} (резервний ключ)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-400">
      {status}
      {!cred.token_format_valid ? " · невалідний" : ""}
    </span>
  );
}

export function ClassroomDiagnosticsPanel({ onNotify }: ClassroomDiagnosticsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [data, setData] = useState<ClassroomCredentialsDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyProblematic, setOnlyProblematic] = useState(true);
  const [copied, setCopied] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");

  const regionId = useId();
  const captionId = useId();

  const loadDiagnostics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.classroom.getDiagnostics();
      setData(res);
      setLiveStatus(`Завантажено діагностику для ${res.total_credentials} акаунтів Classroom.`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не вдалося завантажити діагностику Google Classroom";
      setError(msg);
      setLiveStatus("Помилка завантаження діагностики Classroom.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (expanded && data === null && !loading) {
      loadDiagnostics();
    }
  }, [expanded, data, loading, loadDiagnostics]);

  const filteredCredentials = useMemo(() => {
    const list = data?.credentials ?? [];
    if (!onlyProblematic) return list;
    return list.filter(isProblematicCredential);
  }, [data, onlyProblematic]);

  const problematicCount = useMemo(() => {
    return (data?.credentials ?? []).filter(isProblematicCredential).length;
  }, [data]);

  const handleCopySafeJson = async () => {
    if (!data) return;
    try {
      const safePayload = JSON.stringify(buildSafeDiagnosticsExport(data), null, 2);
      await navigator.clipboard.writeText(safePayload);
      setCopied(true);
      setLiveStatus("Безпечний JSON діагностики скопійовано без токенів і персональних пошт.");
      onNotify?.("Безпечний звіт діагностики скопійовано в буфер обміну", "positive");
      setTimeout(() => setCopied(false), 2200);
    } catch {
      onNotify?.("Не вдалося скопіювати звіт діагностики", "negative");
    }
  };

  const backoffEntries = Object.entries(data?.group_backoffs ?? {});

  return (
    <section
      aria-label="Діагностика токенів Google Classroom"
      className="surface-panel rounded-2xl border border-sys-border bg-sys-card p-4 sm:p-5 shadow-xs space-y-4 mb-5 w-full"
    >
      <div aria-live="polite" className="sr-only">
        {liveStatus}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 text-sky-700 dark:text-sky-400 flex items-center justify-center shrink-0">
            <svg
              aria-hidden="true"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-bold text-sys-text-primary leading-tight">
              Діагностика Google Classroom і токенів
            </h3>
            <p className="text-xs text-sys-text-secondary mt-0.5">
              Перевірка розшифрування refresh_token (<code className="font-mono">token_status</code>),{" "}
              <code className="font-mono">last_error</code>, ключа шифрування та стану фонового крону без розкриття токенів
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={regionId}
          onClick={() => setExpanded((prev) => !prev)}
          className="self-start sm:self-auto shrink-0 min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-2 rounded-lg border border-sys-border bg-sys-bg px-3.5 py-2 text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 hover:text-sys-accent transition-colors cursor-pointer"
        >
          <span>{expanded ? "Згорнути діагностику" : "Відкрити діагностику"}</span>
          {data && (
            <span className="px-1.5 py-0.5 rounded bg-sys-card border border-sys-border text-[11px] font-bold">
              {problematicCount > 0 ? `${problematicCount} пробл.` : `${data.total_credentials} ок`}
            </span>
          )}
        </button>
      </div>

      {expanded && (
        <div id={regionId} className="space-y-4 pt-3 border-t border-sys-border/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                aria-pressed={onlyProblematic}
                onClick={() => setOnlyProblematic(true)}
                className={`min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  onlyProblematic
                    ? "border-sys-accent bg-sys-accent/15 text-sys-text-primary"
                    : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                Лише проблемні ({problematicCount})
              </button>
              <button
                type="button"
                aria-pressed={!onlyProblematic}
                onClick={() => setOnlyProblematic(false)}
                className={`min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  !onlyProblematic
                    ? "border-sys-accent bg-sys-accent/15 text-sys-text-primary"
                    : "border-sys-border bg-sys-bg text-sys-text-secondary hover:text-sys-text-primary"
                }`}
              >
                Усі акаунти ({data?.total_credentials ?? 0})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={loadDiagnostics}
                disabled={loading}
                className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 transition-colors cursor-pointer disabled:opacity-50"
              >
                {loading ? "Оновлення…" : "Оновити"}
              </button>
              <button
                type="button"
                onClick={handleCopySafeJson}
                disabled={!data || loading}
                className="min-h-[40px] sm:min-h-[36px] px-3 py-1.5 rounded-lg border border-sys-border bg-sys-bg text-xs font-semibold text-sys-text-primary hover:border-sys-accent/60 transition-colors cursor-pointer disabled:opacity-50"
              >
                {copied ? "✓ Скопійовано безпечний JSON" : "Копіювати безпечний JSON"}
              </button>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-xs font-medium text-rose-700 dark:text-rose-400"
            >
              {error}
            </div>
          )}

          {data && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-3 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-sys-text-secondary">
                    Ключ шифрування
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold ${
                        data.primary_key_configured
                          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                          : "bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {data.primary_key_configured ? "Виділений ключ задано" : "Резервний seed"}
                    </span>
                    {data.encryption_key_source && (
                      <code className="text-[11px] font-mono text-sys-text-primary">
                        {data.encryption_key_source}
                      </code>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-3 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-sys-text-secondary">
                    Стан акаунтів
                  </div>
                  <div className="text-xs text-sys-text-primary flex flex-wrap gap-x-3 gap-y-1">
                    <span>
                      Усього: <strong>{data.total_credentials}</strong>
                    </span>
                    <span className="text-emerald-700 dark:text-emerald-400">
                      Активні: <strong>{data.active_credentials ?? 0}</strong>
                    </span>
                    <span className="text-rose-700 dark:text-rose-400">
                      Потребують переприв’язки: <strong>{data.needs_relink_credentials ?? 0}</strong>
                    </span>
                    {(data.error_summary?.in_backoff_count ?? 0) > 0 && (
                      <span className="text-amber-800 dark:text-amber-300">
                        Backoff: <strong>{data.error_summary?.in_backoff_count}</strong>
                      </span>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-sys-border bg-sys-bg/60 p-3 space-y-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-sys-text-secondary">
                    Фоновий крон (web / worker)
                  </div>
                  {data.worker_heartbeat ? (
                    <div className="text-xs text-sys-text-primary space-y-0.5">
                      <div>
                        Останній цикл: <strong>{formatDateTime(data.worker_heartbeat.last_finished_at)}</strong>
                        {typeof data.worker_heartbeat.checked_groups === "number" && (
                          <span className="text-sys-text-secondary">
                            {" "}· груп: {data.worker_heartbeat.checked_groups}
                          </span>
                        )}
                      </div>
                      {data.worker_heartbeat.next_run_at && (
                        <div className="text-[11px] text-sys-text-secondary">
                          Наступний: {formatDateTime(data.worker_heartbeat.next_run_at)}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-xs text-sys-text-secondary">Ще не зафіксовано жодного циклу</div>
                  )}
                </div>
              </div>

              {backoffEntries.length > 0 && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs space-y-1">
                  <div className="font-semibold text-amber-800 dark:text-amber-300">
                    Активні групові паузи (backoff):
                  </div>
                  <ul className="flex flex-wrap gap-2">
                    {backoffEntries.map(([gid, info]) => (
                      <li
                        key={gid}
                        className="px-2 py-1 rounded-md border border-amber-500/30 bg-sys-card text-sys-text-primary"
                      >
                        <strong>{info.group_name || `Група #${gid}`}</strong> — спроб: {info.failures}, ще{" "}
                        {Math.max(1, Math.round(info.remaining_seconds / 60))} хв
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {filteredCredentials.length === 0 ? (
                <div className="rounded-xl border border-sys-border bg-sys-bg/40 px-4 py-6 text-center text-xs text-sys-text-secondary">
                  {onlyProblematic
                    ? "Проблемних токенів або помилок синхронізації не виявлено."
                    : "У базі ще немає підключених акаунтів Google Classroom."}
                </div>
              ) : (
                <div
                  tabIndex={0}
                  role="region"
                  aria-labelledby={captionId}
                  className="overflow-x-auto max-h-[440px] rounded-xl border border-sys-border focus:outline-2 focus:outline-sys-accent"
                >
                  <table className="w-full text-left border-separate border-spacing-0 text-xs">
                    <caption id={captionId} className="sr-only">
                      Діагностика токенів та помилок синхронізації Google Classroom
                    </caption>
                    <thead className="sticky top-0 z-10 bg-sys-card border-b border-sys-border text-[11px] uppercase tracking-wide text-sys-text-secondary">
                      <tr>
                        <th scope="col" className="py-2.5 px-3 border-b border-sys-border whitespace-nowrap">
                          Група / ID
                        </th>
                        <th scope="col" className="py-2.5 px-3 border-b border-sys-border whitespace-nowrap">
                          Акаунт
                        </th>
                        <th scope="col" className="py-2.5 px-3 border-b border-sys-border whitespace-nowrap">
                          token_status
                        </th>
                        <th scope="col" className="py-2.5 px-3 border-b border-sys-border whitespace-nowrap">
                          Стан / причина
                        </th>
                        <th scope="col" className="py-2.5 px-3 border-b border-sys-border">
                          last_error
                        </th>
                        <th scope="col" className="py-2.5 px-3 border-b border-sys-border whitespace-nowrap">
                          Остання активність
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-sys-border/60">
                      {filteredCredentials.map((cred) => {
                        const reasonText = cred.reason_code ? REASON_LABELS[cred.reason_code] || cred.reason_code : null;
                        return (
                          <tr key={cred.id} className="hover:bg-sys-bg/50 align-top">
                            <th
                              scope="row"
                              className="sticky left-0 bg-sys-card py-2.5 px-3 font-semibold text-sys-text-primary whitespace-nowrap border-b border-sys-border/60"
                            >
                              <div>{cred.group_name || `Група #${cred.group_id}`}</div>
                              <div className="text-[11px] font-normal text-sys-text-secondary">
                                #{cred.id}
                                {cred.subgroup ? ` · підгр. ${cred.subgroup}` : ""}
                              </div>
                            </th>
                            <td className="py-2.5 px-3 border-b border-sys-border/60">
                              <div className="font-medium text-sys-text-primary">
                                {cred.student_name || "Без імені"}
                              </div>
                              <div className="text-[11px] text-sys-text-secondary">
                                {cred.email || cred.google_user_id}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap border-b border-sys-border/60">
                              {renderTokenBadge(cred)}
                            </td>
                            <td className="py-2.5 px-3 border-b border-sys-border/60">
                              <div className="flex flex-col gap-1">
                                {cred.needs_relink ? (
                                  <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-400">
                                    needs_relink
                                  </span>
                                ) : cred.is_active ? (
                                  <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400">
                                    Активний
                                  </span>
                                ) : (
                                  <span className="inline-flex w-fit items-center px-2 py-0.5 rounded-md border text-[11px] font-semibold bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300">
                                    Неактивний
                                  </span>
                                )}
                                {reasonText && (
                                  <span className="text-[11px] text-sys-text-secondary">{reasonText}</span>
                                )}
                                {cred.fail_count > 0 && (
                                  <span className="text-[11px] text-sys-text-secondary">
                                    Спроб із помилкою: {cred.fail_count}
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 border-b border-sys-border/60">
                              {cred.last_error ? (
                                <code className="block font-mono text-[11px] break-words max-w-[260px] text-rose-700 dark:text-rose-400">
                                  {cred.last_error}
                                </code>
                              ) : (
                                <span className="text-sys-text-secondary">—</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 whitespace-nowrap text-[11px] text-sys-text-secondary border-b border-sys-border/60 space-y-0.5">
                              <div>Синк: {formatDateTime(cred.last_synced_at)}</div>
                              <div>Refresh: {formatDateTime(cred.last_refresh_ok_at)}</div>
                              <div>Клієнт: {formatDateTime(cred.last_client_seen_at)}</div>
                              {cred.next_attempt_at && (
                                <div className="text-amber-800 dark:text-amber-300">
                                  Retry: {formatDateTime(cred.next_attempt_at)}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
