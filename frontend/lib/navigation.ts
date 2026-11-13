export type PublicSectionId =
  | "schedule"
  | "bells"
  | "educational-process"
  | "statistics"
  | "settings";

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
];

export const CORE_PREFETCH_ROUTES: readonly string[] = ["/", "/settings"];

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
