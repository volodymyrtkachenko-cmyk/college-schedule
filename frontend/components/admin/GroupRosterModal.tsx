"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { api, ClassroomGroupRosterResponse } from "../../lib/api";
import { ClassroomSyncButton } from "../ClassroomSyncButton";

function extractSurname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return fullName;

  const last = parts[parts.length - 1].toLowerCase();
  if (
    last.endsWith("ович") ||
    last.endsWith("івна") ||
    last.endsWith("евич") ||
    last.endsWith("євич") ||
    last.endsWith("овна") ||
    last.endsWith("евна")
  ) {
    return parts[0];
  }

  const isSurnameLike = (w: string) => {
    const l = w.toLowerCase();
    return (
      l.endsWith("ко") ||
      l.endsWith("ук") ||
      l.endsWith("юк") ||
      l.endsWith("ак") ||
      l.endsWith("як") ||
      l.endsWith("ич") ||
      l.endsWith("іч") ||
      l.endsWith("ський") ||
      l.endsWith("ська") ||
      l.endsWith("цький") ||
      l.endsWith("цька") ||
      l.endsWith("ов") ||
      l.endsWith("ова") ||
      l.endsWith("єв") ||
      l.endsWith("єва") ||
      l.endsWith("ін") ||
      l.endsWith("іна") ||
      l.endsWith("ець") ||
      l.endsWith("єць") ||
      l.endsWith("ий") ||
      l.endsWith("ій")
    );
  };

  const firstLike = isSurnameLike(parts[0]);
  const lastLike = isSurnameLike(parts[parts.length - 1]);

  if (firstLike && !lastLike) return parts[0];
  if (!firstLike && lastLike) return parts[parts.length - 1];
  return parts[parts.length - 1];
}

function formatLastSynced(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    const now = Date.now();
    const diffSec = Math.floor((now - d.getTime()) / 1000);
    if (diffSec < 60) return "щойно";
    if (diffSec < 3600) {
      const min = Math.floor(diffSec / 60);
      return `${min} хв тому`;
    }
    if (diffSec < 86400) {
      const hours = Math.floor(diffSec / 3600);
      return `${hours} год тому`;
    }
    return d.toLocaleString("uk-UA", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return isoStr;
  }
}

function AdminUserAvatar({
  photoUrl,
  name,
  size = "md",
}: {
  photoUrl?: string | null;
  name?: string | null;
  size?: "sm" | "md";
}) {
  const [hasError, setHasError] = useState(false);
  const initial = name ? name.trim().charAt(0).toUpperCase() : "👤";
  const dim = size === "sm" ? "h-7 w-7 text-xs" : "h-8 w-8 text-xs";

  useEffect(() => {
    setHasError(false);
  }, [photoUrl]);

  const cleanUrl = photoUrl?.trim();
  const isValidUrl = Boolean(
    cleanUrl &&
      (cleanUrl.startsWith("http://") || cleanUrl.startsWith("https://") || cleanUrl.startsWith("//")),
  );

  if (!isValidUrl || hasError) {
    return (
      <div
        className={`${dim} flex shrink-0 items-center justify-center rounded-full bg-sys-tabActive font-bold text-sys-text-secondary border border-sys-border/40 select-none`}
      >
        {initial}
      </div>
    );
  }

  const resolvedUrl = cleanUrl!.startsWith("//") ? `https:${cleanUrl}` : cleanUrl!;

  return (
    <div
      className={`${dim} shrink-0 relative rounded-full overflow-hidden border border-sys-border/50 bg-sys-tabActive flex items-center justify-center select-none`}
    >
      <span className="font-bold text-sys-text-secondary select-none">{initial}</span>
      <img
        src={resolvedUrl}
        alt=""
        aria-hidden="true"
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className="absolute inset-0 h-full w-full object-cover"
      />
    </div>
  );
}

export interface GroupRosterModalProps {
  group: { id: number; name: string } | null;
  onClose: () => void;
  onNotify: (message: string, tone: "success" | "error") => void;
}

export function GroupRosterModal({ group, onClose, onNotify }: GroupRosterModalProps) {
  const shouldReduceMotion = useReducedMotion();
  const [rosterTab, setRosterTab] = useState<"students" | "classroom">("students");
  const [studentSearch, setStudentSearch] = useState("");
  const [studentSortBy, setStudentSortBy] = useState<"surname" | "name">("surname");
  const [studentSortOrder, setStudentSortOrder] = useState<"asc" | "desc">("asc");
  const [bulkStudentOpen, setBulkStudentOpen] = useState(false);
  const [bulkStudentText, setBulkStudentText] = useState("");
  const [bulkStudentReplace, setBulkStudentReplace] = useState(false);
  const [bulkStudentSaving, setBulkStudentSaving] = useState(false);
  const [rosterData, setRosterData] = useState<ClassroomGroupRosterResponse | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [forcingGroupSync, setForcingGroupSync] = useState(false);

  const loadRoster = useCallback(async (targetGroup: { id: number; name: string }, preserveTab = false) => {
    if (!preserveTab) {
      setRosterTab("students");
      setStudentSearch("");
      setStudentSortBy("surname");
      setStudentSortOrder("asc");
      setBulkStudentOpen(false);
      setBulkStudentText("");
      setBulkStudentReplace(false);
    }
    setRosterLoading(true);
    try {
      const data = await api.classroom.groupStudents(targetGroup.id);
      setRosterData(data);
    } catch {
      setRosterData({ course_name: null, last_synced_at: null, students: [] });
    } finally {
      setRosterLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!group) return;
    void loadRoster(group);
  }, [group?.id, loadRoster]);

  const handleBulkStudentImport = async () => {
    if (!group || !bulkStudentText.trim()) return;
    setBulkStudentSaving(true);
    try {
      const res = await api.classroom.bulkImportStudents(group.id, bulkStudentText, bulkStudentReplace);
      onNotify(`Успішно додано ${res.added} студентів (всього: ${res.total})`, "success");
      setBulkStudentOpen(false);
      setBulkStudentText("");
      await loadRoster(group);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Помилка імпорту списку", "error");
    } finally {
      setBulkStudentSaving(false);
    }
  };

  const handleDeleteStudent = async (studentId: number, studentName: string) => {
    if (!group) return;
    if (!confirm(`Видалити студента «${studentName}» зі списку групи?`)) return;
    try {
      await api.classroom.deleteStudent(group.id, studentId);
      onNotify(`Студента «${studentName}» видалено`, "success");
      await loadRoster(group);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Не вдалося видалити студента", "error");
    }
  };

  const handleDeleteClassroomAccount = async (credId: number, accountName: string) => {
    if (!group) return;
    if (!confirm(`Відключити Classroom-акаунт «${accountName}»?`)) return;
    try {
      await api.classroom.deleteCredential(credId);
      onNotify(`Акаунт «${accountName}» відключено`, "success");
      await loadRoster(group, true);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Не вдалося відключити акаунт", "error");
    }
  };

  const handleSyncGroupNow = async () => {
    if (!group || forcingGroupSync) return;
    setForcingGroupSync(true);
    try {
      const updated = await api.classroom.syncGroupNow(group.id);
      setRosterData(updated);
      onNotify("Примусову синхронізацію групи виконано", "success");
    } catch (err) {
      onNotify(err instanceof Error ? err.message : "Не вдалося виконати синхронізацію", "error");
    } finally {
      setForcingGroupSync(false);
    }
  };

  return (
    <AnimatePresence>
      {group && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[130] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Студенти групи ${group.name}`}
            initial={shouldReduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
            animate={shouldReduceMotion ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { y: "100%", opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
            className="flex max-h-[92dvh] sm:max-h-[88vh] w-full max-w-lg sm:max-w-2xl lg:max-w-3xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl border border-sys-border bg-sys-card shadow-2xl pb-safe"
          >
            {/* Header & Tabs */}
            <div className="flex flex-col border-b border-sys-border bg-sys-card">
              <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sys-bg/60 border border-sys-border/60 text-base shrink-0">
                    👥
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-base font-bold text-sys-text-primary truncate">
                        Група {group.name}
                      </h3>
                      {typeof rosterData?.connected_accounts_count === "number" &&
                        rosterData.connected_accounts_count > 0 && (
                          <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium truncate max-w-[200px] sm:max-w-[320px]">
                            · Classroom активний ({rosterData.connected_accounts_count})
                          </span>
                        )}
                    </div>
                    {rosterData?.last_synced_at && (
                      <p className="text-[11px] text-sys-text-muted truncate">
                        Остання синхронізація: {new Date(rosterData.last_synced_at).toLocaleString("uk-UA")}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Закрити"
                  className="w-8 h-8 flex items-center justify-center rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg/60 transition-colors shrink-0"
                >
                  ✕
                </button>
              </div>

              {/* Вкладки: Студенти / Classroom-акаунти */}
              <div className="flex items-center gap-2 px-5 pb-3">
                <button
                  type="button"
                  onClick={() => {
                    setRosterTab("students");
                    setBulkStudentOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    rosterTab === "students"
                      ? "bg-sys-tabActive text-sys-text-primary shadow-sm border border-sys-border/80"
                      : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg/40"
                  }`}
                >
                  <span>👥 Студенти</span>
                  {rosterData?.students && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        rosterTab === "students"
                          ? "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"
                          : "bg-sys-bg text-sys-text-muted"
                      }`}
                    >
                      {rosterData.students.length}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setRosterTab("classroom");
                    setBulkStudentOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    rosterTab === "classroom"
                      ? "bg-sys-tabActive text-sys-text-primary shadow-sm border border-sys-border/80"
                      : "text-sys-text-secondary hover:text-sys-text-primary hover:bg-sys-bg/40"
                  }`}
                >
                  <span>🎓 Classroom-акаунти</span>
                  {typeof rosterData?.connected_accounts_count === "number" && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        rosterData.connected_accounts_count > 0
                          ? "bg-sky-500/20 text-sky-800 dark:text-sky-300"
                          : "bg-amber-500/20 text-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {rosterData.connected_accounts_count}
                    </span>
                  )}
                </button>
              </div>
            </div>

            {/* Вміст вкладки: Classroom-акаунти */}
            {rosterTab === "classroom" && (
              <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                {/* Синхронізація та статус курсу */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-sys-border/60 bg-sys-bg/40 p-3.5">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-sys-text-primary">
                      Синхронізація розкладу та завдань
                    </p>
                    <p className="text-[11px] text-sys-text-muted mt-0.5">
                      {rosterData?.has_subgroups
                        ? "Група має підгрупи: бажано підключити хоча б по 1 студенту з кожної підгрупи"
                        : "Для повної синхронізації завдань достатньо 1 активного акаунта"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-sys-text-secondary">
                      {rosterData?.worker_heartbeat?.last_finished_at ? (
                        <span>
                          Автоцикл воркера: {formatLastSynced(rosterData.worker_heartbeat.last_finished_at)}
                          {typeof rosterData.worker_heartbeat.checked_groups === "number"
                            ? ` (${rosterData.worker_heartbeat.processed?.length ?? 0}/${rosterData.worker_heartbeat.checked_groups} груп)`
                            : ""}
                        </span>
                      ) : (
                        <span>Автоцикл воркера: ще не зафіксовано</span>
                      )}
                      {rosterData?.worker_heartbeat?.errors && rosterData.worker_heartbeat.errors.length > 0 && (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Помилок циклу: {rosterData.worker_heartbeat.errors.length}
                        </span>
                      )}
                      {rosterData?.group_backoff_until && (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Пауза групи до{" "}
                          {new Date(rosterData.group_backoff_until).toLocaleTimeString("uk-UA", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={handleSyncGroupNow}
                      disabled={forcingGroupSync}
                      aria-busy={forcingGroupSync}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-sys-accent/40 bg-sys-accent/10 px-3 py-2 text-xs font-semibold text-sys-accent hover:bg-sys-accent/20 disabled:opacity-50 transition-colors"
                      title="Примусово синхронізувати всі активні акаунти цієї групи прямо зараз"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                        className={forcingGroupSync ? "animate-spin" : ""}
                      >
                        <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
                        <path d="M21 3v5h-5" />
                      </svg>
                      <span>{forcingGroupSync ? "Синхронізація..." : "Оновити зараз"}</span>
                    </button>
                    <ClassroomSyncButton
                      currentGroupId={group.id}
                      onSynced={(_gid, _tasks, _lastSynced, isSilent) => {
                        if (!isSilent) {
                          void loadRoster(group, true);
                        }
                      }}
                    />
                  </div>
                </div>

                {/* Попередження, якщо для підгрупи немає жодного активного акаунта */}
                {rosterData?.subgroup_warning && (
                  <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                    <span className="text-amber-700 dark:text-amber-400 font-bold shrink-0 text-sm">⚠</span>
                    <div>
                      <p className="font-semibold text-amber-900 dark:text-amber-300">Попередження щодо підгруп</p>
                      <p className="text-amber-800/90 dark:text-amber-200/90 text-[11px] leading-relaxed mt-0.5">
                        {rosterData.subgroup_warning}
                      </p>
                    </div>
                  </div>
                )}

                {/* Список підключених акаунтів */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-sys-text-muted px-1">
                    <span>
                      Підключені акаунти ({rosterData?.connected_accounts_count ?? 0} активних з{" "}
                      {rosterData?.accounts?.length ?? 0})
                    </span>
                  </div>

                  {rosterLoading ? (
                    <p className="text-xs text-sys-text-secondary py-4 text-center">Завантаження акаунтів...</p>
                  ) : !rosterData?.accounts || rosterData.accounts.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-sys-border/80 bg-sys-bg/20 p-6 text-center">
                      <p className="text-xs text-sys-text-muted">
                        Для цієї групи ще немає підключених акаунтів Classroom.
                      </p>
                      <p className="text-[11px] text-sys-text-secondary mt-1">
                        Будь-який студент або староста групи може прив&apos;язати свій акаунт у розкладі, щоб відкрити доступ до завдань.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {rosterData.accounts.map((acc, idx) => {
                        const displayName = acc.student_name || `Акаунт #${idx + 1}`;
                        const subtitle = acc.email || "Підключено через Google";
                        const needsRelink = Boolean(
                          acc.needs_relink ||
                            (acc.last_error &&
                              (acc.last_error.includes("missing_or_corrupt_refresh_token") ||
                                acc.last_error.includes("invalid_grant") ||
                                acc.last_error.includes("token_is_access_token_not_refresh_token"))),
                        );
                        const nextAttemptDate = acc.next_attempt_at ? new Date(acc.next_attempt_at) : null;
                        const inBackoff = Boolean(
                          nextAttemptDate &&
                            !Number.isNaN(nextAttemptDate.getTime()) &&
                            nextAttemptDate.getTime() > Date.now(),
                        );
                        const isWorking = acc.is_active && !needsRelink;
                        const hasTempIssue = isWorking && (inBackoff || acc.fail_count > 0 || Boolean(acc.last_error));

                        const errorLabel = (() => {
                          if (acc.reason_code === "key_changed")
                            return "Ключ шифрування змінено — потрібна повторна прив'язка";
                          if (acc.reason_code === "no_refresh_token")
                            return "Потрібне повторне підключення (відсутній токен фонового оновлення)";
                          if (acc.reason_code === "revoked")
                            return "Доступ скасовано у Google — потрібна повторна прив'язка";
                          if (acc.reason_code === "missing_scopes")
                            return "Надано не всі дозволи Classroom — потрібна повторна прив'язка";
                          if (acc.reason_code === "server_secret_missing")
                            return "На сервері відсутній GOOGLE_CLIENT_SECRET";
                          if (
                            acc.last_error?.includes("missing_or_corrupt_refresh_token") ||
                            acc.last_error?.includes("token_is_access_token_not_refresh_token")
                          ) {
                            return "Потрібне повторне підключення (відсутній токен фонового оновлення)";
                          }
                          if (acc.last_error?.includes("invalid_grant")) {
                            return "Доступ скасовано у Google — потрібна повторна прив'язка";
                          }
                          return acc.last_error ? `Помилка: ${acc.last_error}` : null;
                        })();

                        const dotClass =
                          needsRelink || hasTempIssue
                            ? "bg-amber-500 dark:bg-amber-400"
                            : isWorking
                            ? "bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]"
                            : "bg-rose-500 dark:bg-rose-400";

                        const labelClass =
                          needsRelink || hasTempIssue
                            ? "text-amber-700 dark:text-amber-400 font-medium"
                            : isWorking
                            ? "text-emerald-700 dark:text-emerald-400 font-medium"
                            : "text-rose-700 dark:text-rose-400 font-medium";

                        const statusLabel = needsRelink
                          ? "Потрібна прив'язка"
                          : !isWorking
                          ? "Неактивний"
                          : inBackoff
                          ? "Пауза (ліміт/помилка)"
                          : hasTempIssue
                          ? "Тимчасова помилка"
                          : "Активний";

                        return (
                          <div
                            key={acc.id || idx}
                            className="flex flex-col gap-2 rounded-xl border border-sys-border/60 bg-sys-card/70 p-3 text-xs transition-colors hover:border-sys-border"
                          >
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                              {/* Ліва частина: Аватар + Ім'я + Email + Підгрупа */}
                              <div className="flex items-center gap-3 min-w-0">
                                <AdminUserAvatar photoUrl={acc.photo_url} name={acc.student_name} size="md" />

                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="font-semibold text-sys-text-primary text-[13px] truncate">
                                      {displayName}
                                    </span>
                                    {acc.subgroup ? (
                                      <span className="inline-flex shrink-0 items-center gap-1 h-5 px-1.5 rounded-md border border-sys-accent/35 bg-sys-accent/15 text-[10px] font-semibold text-sys-accent">
                                        <span
                                          className="h-1.5 w-1.5 rounded-full bg-sys-accent shrink-0"
                                          aria-hidden="true"
                                        />
                                        <span>{acc.subgroup} підгр.</span>
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="flex items-center gap-2 text-sys-text-muted text-[11px] truncate mt-0.5">
                                    <span>{subtitle}</span>
                                  </div>
                                </div>
                              </div>

                              {/* Права частина: Статус синхронізації + Кнопка відключення */}
                              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-sys-border/30">
                                <div className="text-left sm:text-right">
                                  <div className="flex items-center sm:justify-end gap-1.5 text-[11px]">
                                    <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
                                    <span className={labelClass}>{statusLabel}</span>
                                  </div>
                                  <span className="text-[10px] text-sys-text-secondary block mt-0.5">
                                    {acc.last_synced_at
                                      ? `Синхронізовано ${formatLastSynced(acc.last_synced_at)}`
                                      : acc.last_client_seen_at
                                      ? `Активність ${formatLastSynced(acc.last_client_seen_at)}`
                                      : "ще не синхронізовано"}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleDeleteClassroomAccount(acc.id, displayName)}
                                  className="rounded-lg p-1.5 text-sys-text-muted hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                                  title="Відключити цей акаунт"
                                  aria-label={`Відключити ${displayName}`}
                                >
                                  <svg
                                    width="15"
                                    height="15"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {(errorLabel || inBackoff) && (
                              <div
                                className="w-full text-amber-800 dark:text-amber-300 text-[11px] bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 break-words"
                                title={acc.last_error || errorLabel || undefined}
                              >
                                <span aria-hidden="true">⚠ </span>
                                {errorLabel || "Тимчасова пауза через помилку Google API"}
                                {inBackoff && nextAttemptDate
                                  ? ` · Наступна спроба о ${nextAttemptDate.toLocaleTimeString("uk-UA", {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}`
                                  : null}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Вміст вкладки: Студенти */}
            {rosterTab === "students" && (
              <>
                {bulkStudentOpen ? (
                  <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        onClick={() => setBulkStudentOpen(false)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-sys-text-secondary hover:text-sys-text-primary transition-colors"
                      >
                        ← Назад до списку студентів
                      </button>
                    </div>
                    <div className="rounded-xl border border-sys-border/60 bg-sys-bg/40 p-3 text-xs text-sys-text-secondary">
                      💡 <strong className="text-sys-text-primary">Швидкий імпорт:</strong> відкрийте вкладку{" "}
                      <em>«Пользователи» (або «Люди»)</em> у своєму курсі Google Classroom, виділіть список
                      одногрупників (Ctrl+A / мишкою), скопіюйте (Ctrl+C) та вставте сюди. Також підходить копіювання з
                      Excel або відомості. Розумний парсер сам прибере номери та зайві слова.
                    </div>
                    <div>
                      <textarea
                        rows={8}
                        value={bulkStudentText}
                        onChange={(e) => setBulkStudentText(e.target.value)}
                        placeholder={
                          "Вставте скопійований список студентів тут...\nІванов Іван\nПетренко Петро\nСидоренко Анна..."
                        }
                        className="w-full rounded-xl border border-sys-border bg-sys-bg/60 p-3 text-xs font-mono text-sys-text-primary placeholder:text-sys-text-muted focus:border-emerald-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                      <label className="flex items-center gap-2 text-xs text-sys-text-secondary cursor-pointer">
                        <input
                          type="checkbox"
                          checked={bulkStudentReplace}
                          onChange={(e) => setBulkStudentReplace(e.target.checked)}
                          className="rounded border-sys-border bg-sys-bg text-emerald-500 focus:ring-emerald-500"
                        />
                        <span>Замінити весь існуючий список</span>
                      </label>
                      <div className="flex flex-col-reverse sm:flex-row gap-2">
                        <button
                          type="button"
                          onClick={() => setBulkStudentOpen(false)}
                          className="min-h-[44px] sm:min-h-[36px] flex items-center justify-center rounded-lg border border-sys-border px-3.5 py-1.5 text-xs text-sys-text-secondary hover:text-sys-text-primary"
                        >
                          Скасувати
                        </button>
                        <button
                          type="button"
                          disabled={bulkStudentSaving || !bulkStudentText.trim()}
                          onClick={handleBulkStudentImport}
                          className="min-h-[44px] sm:min-h-[36px] flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 shadow-sm"
                        >
                          {bulkStudentSaving ? "Збереження..." : "💾 Зберегти список"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Компактний тулбар: пошук + сортування + кнопки дій */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-b border-sys-border/60 bg-sys-bg/30 px-5 py-2.5">
                      {/* Ліва частина: Пошук */}
                      <div className="flex-1 min-w-[200px]">
                        <input
                          type="text"
                          value={studentSearch}
                          onChange={(e) => setStudentSearch(e.target.value)}
                          placeholder="Пошук за прізвищем, ім'ям чи email..."
                          className="w-full rounded-lg border border-sys-border bg-sys-bg/60 px-3 py-1.5 text-xs text-sys-text-primary placeholder:text-sys-text-muted focus:border-emerald-500 focus:outline-none min-h-[36px]"
                        />
                      </div>

                      {/* Права частина: Сортування та швидкі дії */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setStudentSortBy((prev) => (prev === "surname" ? "name" : "surname"))}
                          className={`min-h-[36px] flex items-center justify-center rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
                            studentSortBy === "surname"
                              ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                              : "border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-text-primary"
                          }`}
                          title="Перемкнути: сортування за прізвищем чи за повним ім'ям"
                        >
                          {studentSortBy === "surname" ? "👤 По прізвищу" : "📝 По імені"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setStudentSortOrder((prev) => (prev === "asc" ? "desc" : "asc"))}
                          className="min-h-[36px] flex items-center justify-center gap-1 rounded-lg border border-sys-border/80 bg-sys-card px-2 py-1 text-xs font-semibold text-sys-text-secondary hover:border-emerald-500/50 hover:text-sys-text-primary transition-colors whitespace-nowrap"
                          title="Змінити напрямок сортування (А-Я / Я-А)"
                        >
                          <span>{studentSortOrder === "asc" ? "🔤 А → Я" : "🔤 Я → А"}</span>
                        </button>

                        {rosterData && rosterData.students.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              const sorted = [...rosterData.students].sort((a, b) => {
                                const valA = studentSortBy === "surname" ? extractSurname(a.full_name) : a.full_name;
                                const valB = studentSortBy === "surname" ? extractSurname(b.full_name) : b.full_name;
                                const res = valA.localeCompare(valB, "uk", { sensitivity: "base" });
                                return studentSortOrder === "asc" ? res : -res;
                              });
                              const text = sorted.map((s, idx) => `${idx + 1}. ${s.full_name}`).join("\n");
                              void navigator.clipboard.writeText(text);
                              onNotify(`Скопійовано список (${sorted.length} студентів)`, "success");
                            }}
                            className="min-h-[36px] flex items-center rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-xs font-semibold text-sky-800 dark:text-sky-300 hover:bg-sky-500/20 transition-colors whitespace-nowrap"
                            title="Скопіювати нумерований список групи у буфер обміну"
                          >
                            📄 Копіювати
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setBulkStudentOpen(true)}
                          className="min-h-[36px] flex items-center rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 transition-colors whitespace-nowrap"
                          title="Швидкий імпорт списку"
                        >
                          📋 Вставити
                        </button>
                      </div>
                    </div>

                    {/* Список студентів (2 колонки на sm:) */}
                    <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                      {rosterLoading ? (
                        <p className="text-sm text-sys-text-secondary py-6 text-center">Завантаження списку...</p>
                      ) : !rosterData || rosterData.students.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-sys-border/80 bg-sys-bg/20 p-8 text-center">
                          <p className="text-sm font-semibold text-sys-text-primary">Список групи порожній</p>
                          <p className="text-xs text-sys-text-muted mt-1.5 max-w-md mx-auto">
                            Натисніть «📋 Вставити», щоб вставити скопійований список з Classroom чи Excel, або
                            синхронізуйте групу у вкладці «Classroom-акаунти».
                          </p>
                        </div>
                      ) : (
                        (() => {
                          const filtered = rosterData.students
                            .filter((st) => {
                              if (!studentSearch.trim()) return true;
                              const q = studentSearch.toLowerCase();
                              return (
                                st.full_name.toLowerCase().includes(q) ||
                                (st.email && st.email.toLowerCase().includes(q))
                              );
                            })
                            .slice()
                            .sort((a, b) => {
                              const valA = studentSortBy === "surname" ? extractSurname(a.full_name) : a.full_name;
                              const valB = studentSortBy === "surname" ? extractSurname(b.full_name) : b.full_name;
                              let res = valA.localeCompare(valB, "uk", { sensitivity: "base" });
                              if (res === 0) {
                                res = a.full_name.localeCompare(b.full_name, "uk", { sensitivity: "base" });
                              }
                              return studentSortOrder === "asc" ? res : -res;
                            });

                          if (filtered.length === 0) {
                            return (
                              <p className="text-xs text-sys-text-muted py-6 text-center">
                                Не знайдено студентів за запитом «{studentSearch}»
                              </p>
                            );
                          }

                          return (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {filtered.map((st, i) => (
                                <div
                                  key={st.id}
                                  className="flex items-center justify-between gap-2 rounded-xl border border-sys-border/60 bg-sys-bg/40 px-3 py-2 text-xs transition-colors hover:border-sys-border hover:bg-sys-bg/60"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="w-5 text-[11px] font-bold text-sys-text-muted shrink-0 text-center">
                                      {i + 1}
                                    </span>
                                    <AdminUserAvatar photoUrl={st.photo_url} name={st.full_name} size="sm" />
                                    <div className="min-w-0">
                                      <p className="font-semibold text-sys-text-primary text-[13px] truncate">
                                        {st.full_name}
                                      </p>
                                      {st.email && (
                                        <p className="text-[11px] text-sys-text-muted truncate">{st.email}</p>
                                      )}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteStudent(st.id, st.full_name)}
                                    className="rounded-lg p-1.5 text-sys-text-muted hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors shrink-0"
                                    title={`Видалити ${st.full_name} зі списку групи`}
                                  >
                                    <svg
                                      width="14"
                                      height="14"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M18 6 6 18M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ))}
                            </div>
                          );
                        })()
                      )}
                    </div>
                  </>
                )}
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
