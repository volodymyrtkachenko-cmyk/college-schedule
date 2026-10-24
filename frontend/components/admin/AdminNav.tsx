"use client";

import Link from "next/link";
import { useAuth } from "../../lib/auth";
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { api, ReferenceResource } from "../../lib/api";

export const referenceLabels: Record<ReferenceResource, string> = {
  faculties: "Спеціальності",
  groups: "Групи",
  teachers: "Викладачі",
  subjects: "Предмети",
};

export const pageTitles: Record<string, string> = {
  schedule: "Розклад",
  "permanent-schedule": "Постійний розклад",
  import: "Імпорт з КРЕ",
  periods: "Графік процесу",
  versions: "Версії",
  semester: "Семестр",
  "learning-mode": "Режим навчання",
  curriculum: "Навантаження",
  constraints: "Обмеження",
  generator: "Генерація розкладу",
  groups: "Групи",
  teachers: "Викладачі",
  subjects: "Предмети",
  faculties: "Спеціальності",
  users: "Користувачі",
};

/* Linear SVG Icons */
function ScheduleIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
      <line x1="8" x2="8" y1="14" y2="14" />
      <line x1="12" x2="12" y1="14" y2="14" />
      <line x1="16" x2="16" y1="14" y2="14" />
    </svg>
  );
}

function ImportIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  );
}

function CalendarRangeIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
      <path d="M7 14h4" />
      <path d="M13 18h4" />
    </svg>
  );
}

function VersionsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.287 1.288L3 12l5.8 1.9a2 2 0 0 1 1.288 1.287L12 21l1.9-5.8a2 2 0 0 1 1.287-1.288L21 12l-5.8-1.9a2 2 0 0 1-1.288-1.287Z" />
    </svg>
  );
}

function SemesterIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function GeneratorWandIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 4V2" />
      <path d="M15 16v-2" />
      <path d="M8 9h2" />
      <path d="M20 9h2" />
      <path d="M17.8 11.8 19 13" />
      <path d="M15 9h.01" />
      <path d="M17.8 6.2 19 5" />
      <path d="m3 21 9-9" />
      <path d="M12.2 6.2 11 5" />
    </svg>
  );
}

function CurriculumIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function ConstraintsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

function PlayGeneratorIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="6 3 20 12 6 21 6 3" />
    </svg>
  );
}

function GroupsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function TeachersIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
      <path d="M6 12v5c3 3 9 3 12 0v-5" />
    </svg>
  );
}

function SubjectsIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  );
}

function FacultiesIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="16" height="20" x="4" y="2" rx="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}

function UsersIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <line x1="19" x2="19" y1="8" y2="14" />
      <line x1="22" x2="16" y1="11" y2="11" />
    </svg>
  );
}

export function AdminNav({ active }: { active: string }) {
  const { user, logout } = useAuth();
  const shouldReduceMotion = useReducedMotion();
  const [online, setOnline] = useState<number | null>(null);
  const [metrics, setMetrics] = useState<any>(null);
  const [onlineExpanded, setOnlineExpanded] = useState(false);
  const [anomalyDraftsCount, setAnomalyDraftsCount] = useState<number>(0);
  const [generatorExpanded, setGeneratorExpanded] = useState(
    ["curriculum", "constraints", "generator"].includes(active)
  );

  // Responsive Drawer state for mobile (< 1024px)
  const [drawerOpen, setDrawerOpen] = useState(false);
  const touchStartX = useRef<number | null>(null);

  // Desktop sidebar collapse state (≥ 1024px)
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutInFlight = useRef(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("admin_sidebar_collapsed");
      if (saved === "true") {
        setIsDesktopCollapsed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const toggleDesktopCollapse = () => {
    setIsDesktopCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("admin_sidebar_collapsed", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  // Keyboard shortcut Ctrl+B or Cmd+B to toggle sidebar collapse
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleDesktopCollapse();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleLogout = async () => {
    if (logoutInFlight.current) return;
    logoutInFlight.current = true;
    setIsLoggingOut(true);
    setLogoutError("");
    try {
      await logout();
    } catch (e: any) {
      setLogoutError(e.message || "Помилка виходу");
    } finally {
      logoutInFlight.current = false;
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    if (user?.role !== "admin") return;
    const fetchMetrics = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const session = await api.auth.ensureAuthenticated();
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/metrics`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        );
        if (res.ok) {
          const data = await res.json();
          setOnline(data.online);
          setMetrics(data);
        }
      } catch {
        // fail silently
      }
    };
    fetchMetrics();
    const interval = setInterval(fetchMetrics, 5_000);
    document.addEventListener("visibilitychange", fetchMetrics);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", fetchMetrics);
    };
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== "admin") return;
    let cancelled = false;
    const checkImportStatus = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const st = await api.importer.getStatus();
        if (!cancelled && st) {
          setAnomalyDraftsCount(st.anomaly_drafts_count || 0);
        }
      } catch {
        // fail silently
      }
    };
    void checkImportStatus();
    const interval = setInterval(checkImportStatus, 20_000);
    document.addEventListener("visibilitychange", checkImportStatus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", checkImportStatus);
    };
  }, [user]);

  useEffect(() => {
    if (!drawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [drawerOpen]);

  // Touch handlers for swipe-to-close drawer
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const diff = touchStartX.current - e.touches[0].clientX;
    if (diff > 60) {
      setDrawerOpen(false);
      touchStartX.current = null;
    }
  };
  const onTouchEnd = () => {
    touchStartX.current = null;
  };

  const linkClass = (isActive: boolean) =>
    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
      isActive
        ? "border border-sys-accent/30 bg-sys-accent/15 text-sys-accent font-semibold"
        : "border border-transparent text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary"
    }`;

  // Inner navigation content used in both Desktop Sidebar and Mobile Drawer
  const renderNavContent = () => {
    return (
      <div className="flex flex-col h-full justify-between">
        <div className="overflow-y-auto px-3 py-4 space-y-5">
          {/* Logo / Header */}
          <div className="flex items-center justify-between pb-1">
            <Link
              href="/"
              className="flex items-center gap-2 hover:opacity-85 transition-opacity"
              title="Повернутися на сайт розкладу"
            >
              <span className="text-[13px] font-black tracking-widest text-sys-accent bg-sys-accent/15 border border-sys-accent/25 px-1.5 py-0.5 rounded shadow-xs shrink-0">
                ДФКР
              </span>
              <span className="font-bold text-[14px] text-sys-text-primary tracking-tight whitespace-nowrap truncate">
                Керування
              </span>
            </Link>

            <div className="flex items-center gap-1">
              {/* Desktop collapse button ‹ */}
              <button
                type="button"
                aria-label="Згорнути меню"
                title="Згорнути меню (Ctrl+B)"
                onClick={toggleDesktopCollapse}
                className="hidden lg:flex items-center justify-center w-7 h-7 rounded-lg text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary transition-colors text-base font-bold"
              >
                ‹
              </button>
              {/* Mobile close button */}
              <button
                type="button"
                aria-label="Закрити меню"
                onClick={() => setDrawerOpen(false)}
                className="lg:hidden rounded-lg p-1.5 text-sys-text-secondary hover:bg-slate-100 dark:hover:bg-white/5 hover:text-sys-text-primary"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m18 6-12 12M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Group 1: РОЗКЛАД */}
          <div>
            <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
              Розклад
            </div>
            <div className="space-y-1">
              <Link
                href="/admin?resource=schedule"
                onClick={() => setDrawerOpen(false)}
                aria-current={active === "schedule" ? "page" : undefined}
                className={linkClass(active === "schedule")}
              >
                <ScheduleIcon className="w-4 h-4 shrink-0 text-current" />
                <span className="truncate">Сітка розкладу</span>
              </Link>

              {user?.role === "editor" && (
                <Link
                  href="/admin?resource=groups"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "groups" ? "page" : undefined}
                  className={linkClass(active === "groups")}
                >
                  <GroupsIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Групи</span>
                </Link>
              )}

              {user?.role === "admin" && (
                <>
                  <Link
                    href="/admin?resource=versions"
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active === "versions" || active === "semester" ? "page" : undefined}
                    className={linkClass(active === "versions" || active === "semester")}
                  >
                    <VersionsIcon className="w-4 h-4 shrink-0 text-current" />
                    <span className="truncate">Версії та семестри</span>
                  </Link>

                  <Link
                    href="/admin?resource=learning-mode"
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active === "learning-mode" ? "page" : undefined}
                    className={linkClass(active === "learning-mode")}
                  >
                    <CalendarRangeIcon className="w-4 h-4 shrink-0 text-current" />
                    <span className="truncate">Режим навчання</span>
                  </Link>

                  <Link
                    href="/admin?resource=periods"
                    onClick={() => setDrawerOpen(false)}
                    aria-current={active === "periods" ? "page" : undefined}
                    className={linkClass(active === "periods")}
                    title="Графік процесу (Практики, канікули, сесії)"
                  >
                    <CalendarRangeIcon className="w-4 h-4 shrink-0 text-current" />
                    <span className="truncate">Графік процесу</span>
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Group 2: АВТОМАТИЗАЦІЯ */}
          {user?.role === "admin" && (
            <div>
              <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
                Автоматизація
              </div>
              <div className="space-y-1">
                <Link
                  href="/admin?resource=curriculum"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "curriculum" ? "page" : undefined}
                  className={linkClass(active === "curriculum")}
                >
                  <CurriculumIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Навантаження</span>
                </Link>

                <Link
                  href="/admin?resource=constraints"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "constraints" ? "page" : undefined}
                  className={linkClass(active === "constraints")}
                >
                  <ConstraintsIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Обмеження викладачів</span>
                </Link>

                <Link
                  href="/admin?resource=generator"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "generator" ? "page" : undefined}
                  className={linkClass(active === "generator")}
                >
                  <PlayGeneratorIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Генерація розкладу</span>
                </Link>

                <Link
                  href="/admin?resource=import"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "import" ? "page" : undefined}
                  className={linkClass(active === "import")}
                >
                  <ImportIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Імпорт з КРЕ</span>
                  {anomalyDraftsCount > 0 && (
                    <span
                      className="ml-auto inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-bold leading-none text-white bg-rose-500 rounded-full shadow-xs shrink-0"
                      title={`Необхідна перевірка: ${anomalyDraftsCount} аномальних чернеток`}
                    >
                      {anomalyDraftsCount}
                    </span>
                  )}
                </Link>
              </div>
            </div>
          )}

          {/* Group 3: ДОВІДНИКИ */}
          {user?.role === "admin" && (
            <div>
              <div className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-wider text-sys-text-muted">
                Довідники
              </div>
              <div className="space-y-1">
                <Link
                  href="/admin?resource=groups"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "groups" ? "page" : undefined}
                  className={linkClass(active === "groups")}
                >
                  <GroupsIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Групи</span>
                </Link>

                <Link
                  href="/admin?resource=teachers"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "teachers" ? "page" : undefined}
                  className={linkClass(active === "teachers")}
                >
                  <TeachersIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Викладачі</span>
                </Link>

                <Link
                  href="/admin?resource=subjects"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "subjects" ? "page" : undefined}
                  className={linkClass(active === "subjects")}
                >
                  <SubjectsIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Предмети</span>
                </Link>

                <Link
                  href="/admin?resource=faculties"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "faculties" ? "page" : undefined}
                  className={linkClass(active === "faculties")}
                >
                  <FacultiesIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Спеціальності</span>
                </Link>

                <Link
                  href="/admin?resource=users"
                  onClick={() => setDrawerOpen(false)}
                  aria-current={active === "users" ? "page" : undefined}
                  className={linkClass(active === "users")}
                >
                  <UsersIcon className="w-4 h-4 shrink-0 text-current" />
                  <span className="truncate">Користувачі</span>
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Bottom Area: Compact User card + online status + Logout icon */}
        <div className="p-3 border-t border-sys-border bg-sys-bg/40">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-sys-border bg-sys-card p-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sys-accent/15 border border-sys-accent/30 text-xs font-bold text-sys-accent uppercase">
                {user?.username ? user.username.slice(0, 2).toUpperCase() : "AD"}
                <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-sys-card" />
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-sys-text-primary truncate leading-tight">
                  {user?.name || user?.username || "Диспетчер"}
                </p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {online !== null ? `${online} онлайн` : "В мережі"}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              disabled={isLoggingOut}
              onClick={() => void handleLogout()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-sys-border text-sys-text-secondary hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-400 transition-colors disabled:opacity-50"
              title="Вийти з системи"
              aria-label="Вийти з системи"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
          {logoutError && (
            <div role="alert" className="text-rose-400 text-[10px] text-center font-medium mt-1">
              {logoutError}
            </div>
          )}
        </div>
      </div>
    );
  };

  const currentPageTitle = pageTitles[active] || "Адміністрування";

  return (
    <>
      {/* 1. Mobile top bar (< 1024px): 56px sticky top with hamburger */}
      <header className="lg:hidden flex items-center justify-between h-14 px-4 bg-sys-bg border-b border-sys-border sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <button
            type="button"
            aria-label="Відкрити меню навігації"
            aria-expanded={drawerOpen}
            aria-controls="admin-drawer"
            onClick={() => setDrawerOpen(true)}
            className="relative flex items-center justify-center w-10 h-10 rounded-lg text-sys-text-secondary hover:text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 transition-colors focus:outline-none focus:ring-2 focus:ring-sys-accent"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
            {anomalyDraftsCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-sys-bg" />
            )}
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-black tracking-wider text-sys-accent bg-sys-accent/15 border border-sys-accent/25 px-1.5 py-0.5 rounded shadow-xs">
              ДФКР
            </span>
            <span className="font-bold text-[15px] text-sys-text-primary truncate max-w-[180px] sm:max-w-[280px]">
              {currentPageTitle}
            </span>
          </div>
        </div>

        <Link
          href="/"
          className="text-xs font-semibold text-sys-accent hover:underline px-2 py-1"
        >
          На сайт ↗
        </Link>
      </header>

      {/* 2. Mobile Drawer (< 1024px): slides from left with backdrop and touch swipe */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[70] bg-[#0b1120]/80 backdrop-blur-xs lg:hidden"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              id="admin-drawer"
              aria-label="Навігація адмінпанелі"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              initial={shouldReduceMotion ? { opacity: 0 } : { x: "-100%" }}
              animate={shouldReduceMotion ? { opacity: 1 } : { x: 0 }}
              exit={shouldReduceMotion ? { opacity: 0 } : { x: "-100%" }}
              transition={{ duration: 0.22, ease: [0.2, 0, 0, 1] }}
              className="fixed top-0 left-0 bottom-0 z-[80] w-[min(320px,86vw)] bg-sys-card border-r border-sys-border flex flex-col shadow-2xl lg:hidden"
            >
              {renderNavContent()}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* 3. Floating desktop toggle button when collapsed */}
      {isDesktopCollapsed && (
        <button
          type="button"
          onClick={toggleDesktopCollapse}
          className="hidden lg:flex fixed top-3.5 left-3.5 z-40 items-center justify-center w-9 h-9 rounded-lg border border-sys-border bg-sys-card text-sys-text-secondary hover:text-sys-text-primary hover:bg-slate-100 dark:hover:bg-white/5 shadow-lg transition-colors duration-fast ease-smooth active:scale-95"
          title="Розгорнути бічне меню (Ctrl+B)"
          aria-label="Розгорнути бічне меню"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
          {anomalyDraftsCount > 0 && (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-sys-card" />
          )}
        </button>
      )}

      {/* 4. Desktop Sidebar (≥ 1024px): 240px when expanded, 0px when collapsed */}
      <aside
        aria-label="Навігація адмінпанелі"
        className={`hidden lg:flex shrink-0 h-screen sticky top-0 border-r border-sys-border bg-sys-card flex-col z-30 transition-[width] duration-200 ease-in-out ${
          isDesktopCollapsed ? "w-0 overflow-hidden border-none" : "w-[240px]"
        }`}
      >
        <div className="w-[240px] h-full flex flex-col justify-between overflow-hidden">
          {renderNavContent()}
        </div>
      </aside>
    </>
  );
}
