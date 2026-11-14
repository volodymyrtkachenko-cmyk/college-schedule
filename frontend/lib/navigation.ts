export type PublicSectionId =
  | "schedule"
  | "bells"
  | "educational-process"
  | "statistics"
  | "atlas"
  | "settings";

export type MobileHomeTab = "schedule" | "tasks";
export type MobileTab = MobileHomeTab | "settings";
export type ScheduleMode = "student" | "teacher";

export type RouteTransitionDirection = "route-forward" | "route-backward";

export interface PublicNavItem {
  id: PublicSectionId;
  href: string;
  label: string;
  shortLabel: string;
  rank: number;
}

export const PUBLIC_NAV_ITEMS: readonly PublicNavItem[] = [
  { id: "schedule", href: "/", label: "Розклад", shortLabel: "Розклад", rank: 0 },
  { id: "bells", href: "/bells", label: "Дзвінки", shortLabel: "Дзвінки", rank: 1 },
  {
    id: "educational-process",
    href: "/educational-process",
    label: "Графік",
    shortLabel: "Графік",
    rank: 2,
  },
  {
    id: "statistics",
    href: "/statistics",
    label: "Статистика",
    shortLabel: "Стат.",
    rank: 3,
  },
  {
    id: "atlas",
    href: "/atlas",
    label: "Атлас ДФКР",
    shortLabel: "Атлас",
    rank: 3.5,
  },
];

export const CORE_PREFETCH_ROUTES: readonly string[] = [
  "/",
  "/settings",
  "/bells",
  "/educational-process",
  "/statistics",
  "/atlas",
];

/**
 * Normalizes a Next.js href or path into a canonical pathname without query/hash.
 */
export function normalizeRoutePath(hrefOrPath: string): string {
  if (!hrefOrPath) return "/";
  const withoutHash = hrefOrPath.split("#")[0] || "/";
  const withoutQuery = withoutHash.split("?")[0] || "/";
  if (withoutQuery.length > 1 && withoutQuery.endsWith("/")) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
}

/**
 * Extracts target string href from Next.js Link href prop (string or UrlObject).
 */
export function resolveHrefString(
  href: string | { pathname?: string | null; query?: Record<string, unknown> | string | null; hash?: string | null },
): string {
  if (typeof href === "string") return href;
  const pathname = href.pathname || "/";
  let queryStr = "";
  if (typeof href.query === "string") {
    queryStr = href.query ? `?${href.query.replace(/^\?/, "")}` : "";
  } else if (href.query && typeof href.query === "object") {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(href.query)) {
      if (v !== undefined && v !== null) {
        params.set(k, String(v));
      }
    }
    const serialized = params.toString();
    queryStr = serialized ? `?${serialized}` : "";
  }
  const hash = href.hash ? (href.hash.startsWith("#") ? href.hash : `#${href.hash}`) : "";
  return `${pathname}${queryStr}${hash}`;
}

/**
 * Assigns an ordered rank to public routes for directional horizontal View Transitions.
 */
export function getRouteRank(pathname: string): number {
  const path = normalizeRoutePath(pathname);
  if (path === "/") return 0;
  if (path.startsWith("/group/") || path.startsWith("/teacher/")) return 0.5;
  if (path === "/bells") return 1;
  if (path === "/educational-process") return 2;
  if (path === "/statistics") return 3;
  if (path === "/atlas") return 3.5;
  if (path === "/settings") return 4;
  if (path.startsWith("/admin")) return 5;
  return 1;
}

/**
 * Determines directional slide type between two routes, or null for same-pathname query changes.
 */
export function getRouteDirection(
  fromPath: string,
  toPath: string,
): RouteTransitionDirection | null {
  const fromNorm = normalizeRoutePath(fromPath);
  const toNorm = normalizeRoutePath(toPath);
  if (fromNorm === toNorm) return null;
  return getRouteRank(toNorm) >= getRouteRank(fromNorm)
    ? "route-forward"
    : "route-backward";
}

/**
 * Checks whether a top-level navigation tab matches the current pathname.
 */
export function isPublicSectionActive(
  pathname: string,
  sectionId: PublicSectionId,
): boolean {
  const path = normalizeRoutePath(pathname);
  if (sectionId === "schedule") {
    return path === "/" || path.startsWith("/group/") || path.startsWith("/teacher/");
  }
  return path === `/${sectionId}`;
}

/**
 * Checks whether a pathname renders the main schedule view or a direct group/teacher schedule.
 */
export function isScheduleRoutePath(pathname?: string | null): boolean {
  if (!pathname) return false;
  const path = normalizeRoutePath(pathname);
  return path === "/" || path.startsWith("/group/") || path.startsWith("/teacher/");
}

/**
 * Resolves which mobile homepage tab should open for a schedule URL.
 * Any schedule route without explicit `?tab=tasks` defaults back to `"schedule"`.
 */
export function resolveHomeTabFromLocation(
  pathname?: string | null,
  search = "",
): MobileHomeTab {
  if (!isScheduleRoutePath(pathname)) return "schedule";
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  return params.get("tab") === "tasks" ? "tasks" : "schedule";
}

/**
 * Computes the active BottomNav item (null on auxiliary subpages like /bells or /statistics).
 */
export function resolveActiveMobileTab(
  pathname?: string | null,
  homeTab: MobileHomeTab = "schedule",
): MobileTab | null {
  if (!pathname) return null;
  const path = normalizeRoutePath(pathname);
  if (path === "/settings" || path.startsWith("/settings/")) {
    return "settings";
  }
  if (isScheduleRoutePath(path)) {
    return homeTab;
  }
  return null;
}

/**
 * Resolves effective student/teacher mode from URL query param first, falling back to stored preference.
 */
export function resolveEffectiveScheduleMode(
  search = "",
  storedMode?: string | null,
): ScheduleMode {
  const params = new URLSearchParams(search.replace(/^\?/, ""));
  const urlMode = params.get("mode");
  if (urlMode === "teacher" || urlMode === "student") {
    return urlMode;
  }
  return storedMode === "teacher" ? "teacher" : "student";
}

/**
 * Extracts optional tasks board subtab (`tasks` | `grades`) from URL search query.
 */
export function resolveScheduleSubtabFromSearch(
  search = "",
): "tasks" | "grades" | null {
  const subtab = new URLSearchParams(search.replace(/^\?/, "")).get("subtab");
  return subtab === "grades" || subtab === "tasks" ? subtab : null;
}

/**
 * Builds homepage href for Guide CTAs opening either Classroom tasks or grades view.
 */
export function buildGuideTasksHref(
  subtab: "tasks" | "grades",
  pathname?: string | null,
  currentSearch = "",
): string {
  const cleanSearch = currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch;
  const params = new URLSearchParams(cleanSearch);
  params.set("tab", "tasks");
  params.set("mode", "student");
  if (subtab === "grades") {
    params.set("subtab", "grades");
  } else {
    params.delete("subtab");
  }
  const normalizedPath = pathname ? normalizeRoutePath(pathname) : "/";
  const basePath = normalizedPath.startsWith("/group/") ? normalizedPath : "/";
  return `${basePath}?${params.toString()}`;
}

/**
 * Формує рядок query-параметрів для мобільної вкладки розкладу/завдань/оцінок,
 * зберігаючи решту параметрів URL (наприклад, mode або date).
 */
export function buildScheduleTabSearch(
  currentSearch: string,
  tab: MobileHomeTab,
  subtab?: "tasks" | "grades" | null,
): string {
  const clean = currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch;
  const params = new URLSearchParams(clean);

  if (tab === "schedule") {
    params.delete("tab");
    params.delete("subtab");
  } else {
    params.set("tab", "tasks");
    if (subtab === "grades") {
      params.set("subtab", "grades");
    } else {
      params.delete("subtab");
    }
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

/**
 * Будує відносний URL мобільної вкладки зі збереженням поточного
 * шляху (/group/[code] або /teacher/[slug]) та решти query-параметрів.
 */
export function buildCurrentScheduleHref(
  pathname: string | null | undefined,
  currentSearch: string,
  tab: MobileHomeTab,
  subtab?: "tasks" | "grades" | null,
  hash = "",
): string {
  const basePath = isScheduleRoutePath(pathname) ? normalizeRoutePath(pathname ?? "/") : "/";
  const search = buildScheduleTabSearch(currentSearch, tab, subtab);
  const normalizedHash = hash ? (hash.startsWith("#") ? hash : `#${hash}`) : "";
  return `${basePath}${search}${normalizedHash}`;
}

/**
 * Ensures post-login redirect targets stay within the app (blocks protocol-relative and external URLs).
 */
export function sanitizeInternalRedirect(
  raw?: string | null,
  fallback = "/",
): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    /[\r\n]/.test(trimmed) ||
    trimmed === "/login" ||
    trimmed.startsWith("/login?") ||
    trimmed.startsWith("/login/")
  ) {
    return fallback;
  }
  return trimmed;
}

/**
 * Checks whether a click event includes modifier keys or non-primary mouse buttons.
 */
export function isModifiedMouseClick(event: {
  metaKey?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  button?: number;
}): boolean {
  return Boolean(
    event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      (typeof event.button === "number" && event.button !== 0),
  );
}
