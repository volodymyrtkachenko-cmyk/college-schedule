"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useTransition,
} from "react";
import Link, { type LinkProps } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import {
  getCurrentAcademicYear,
  readCacheSnapshot,
  writeCacheSnapshot,
} from "@/lib/cacheSnapshot";
import {
  CORE_PREFETCH_ROUTES,
  getRouteDirection,
  isModifiedMouseClick,
  normalizeRoutePath,
  resolveHrefString,
} from "@/lib/navigation";
import { startTypedViewTransition, type ViewTransitionHandle } from "@/lib/viewTransition";

interface NavigateOptions {
  scroll?: boolean;
  replace?: boolean;
}

interface NavigationTransitionContextValue {
  push: (href: string, options?: NavigateOptions) => void;
  replace: (href: string, options?: Omit<NavigateOptions, "replace">) => void;
  prefetchRoute: (href: string) => void;
  isPending: boolean;
}

const NavigationTransitionContext = createContext<NavigationTransitionContextValue>({
  push: () => {},
  replace: () => {},
  prefetchRoute: () => {},
  isPending: false,
});

const PREFETCH_TTL_MS = 25_000;

function shouldSkipBackgroundWarmup(): boolean {
  if (typeof navigator === "undefined") return true;
  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  };
  if (nav.connection?.saveData) return true;
  const effectiveType = nav.connection?.effectiveType;
  return effectiveType === "slow-2g" || effectiveType === "2g";
}

function warmRouteDataInBackground(targetPath: string): void {
  if (shouldSkipBackgroundWarmup()) return;
  const path = normalizeRoutePath(targetPath);

  if (path === "/educational-process") {
    const year = getCurrentAcademicYear();
    const key = `edu-process:${year}`;
    if (!readCacheSnapshot(key)?.fresh) {
      void api
        .educationalProcess(year)
        .then((data) => writeCacheSnapshot(key, data))
        .catch(() => {});
    }
    return;
  }

  if (path === "/statistics") {
    if (!readCacheSnapshot("directory:groups")?.fresh) {
      void api
        .groups()
        .then((data) => writeCacheSnapshot("directory:groups", data))
        .catch(() => {});
    }
    if (!readCacheSnapshot("directory:teachers")?.fresh) {
      void api.directory
        .teachers()
        .then((data) => writeCacheSnapshot("directory:teachers", data))
        .catch(() => {});
    }
  }
}

export function NavigationTransitionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const [isPending, startNavTransition] = useTransition();

  const prefetchedAtRef = useRef<Map<string, number>>(new Map());
  const pendingResolverRef = useRef<(() => void) | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  const activeVtRef = useRef<ViewTransitionHandle | null>(null);
  const lastNavTargetRef = useRef<string | null>(null);

  const flushPendingTransition = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (pendingResolverRef.current) {
      const resolve = pendingResolverRef.current;
      pendingResolverRef.current = null;
      resolve();
    }
  }, []);

  // Resolve active View Transition synchronously right after React commits the new route DOM
  useLayoutEffect(() => {
    flushPendingTransition();
  }, [pathname, flushPendingTransition]);

  useEffect(() => {
    return () => {
      flushPendingTransition();
    };
  }, [flushPendingTransition]);

  const prefetchRoute = useCallback(
    (href: string) => {
      const targetPath = normalizeRoutePath(href);
      const now = Date.now();
      const last = prefetchedAtRef.current.get(href) ?? 0;
      if (now - last > PREFETCH_TTL_MS) {
        prefetchedAtRef.current.set(href, now);
        try {
          router.prefetch(href);
        } catch {
          // Ignore prefetch errors on offline/unsupported targets
        }
      }
      warmRouteDataInBackground(targetPath);
    },
    [router],
  );

  // Keep core routes (/ and /settings + active mode query & public subpages) warm in Next.js Router Cache
  useEffect(() => {
    if (shouldSkipBackgroundWarmup()) return;

    const warmCoreRoutes = () => {
      const now = Date.now();
      let storedMode: string | null = null;
      try {
        storedMode = window.localStorage.getItem("schedule:mode");
      } catch {}
      const activeSettingsRoute =
        storedMode === "teacher" ? "/settings?mode=teacher" : "/settings?mode=student";
      const targets = [...CORE_PREFETCH_ROUTES, activeSettingsRoute];

      for (const route of targets) {
        if (normalizeRoutePath(route) === normalizeRoutePath(pathname)) continue;
        const last = prefetchedAtRef.current.get(route) ?? 0;
        if (now - last > PREFETCH_TTL_MS) {
          prefetchedAtRef.current.set(route, now);
          try {
            router.prefetch(route);
          } catch {
            // Ignore
          }
        }
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        warmCoreRoutes();
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };

    if (typeof win.requestIdleCallback === "function") {
      const id = win.requestIdleCallback(warmCoreRoutes, { timeout: 850 });
      return () => {
        document.removeEventListener("visibilitychange", handleVisibility);
        win.cancelIdleCallback?.(id);
      };
    }
    const timer = window.setTimeout(warmCoreRoutes, 350);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(timer);
    };
  }, [pathname, router]);

  const navigateWithTransition = useCallback(
    (href: string, options?: NavigateOptions) => {
      const targetPath = normalizeRoutePath(href);
      const direction = getRouteDirection(pathname, targetPath);
      const scrollOpt = options?.scroll ?? true;
      const runRouterNav = () => {
        startNavTransition(() => {
          if (options?.replace) {
            router.replace(href, { scroll: scrollOpt });
          } else {
            router.push(href, { scroll: scrollOpt });
          }
        });
      };

      // Same-pathname query updates or reduced-motion/unsupported VT: navigate immediately
      const isDesktopViewport =
        typeof window !== "undefined" &&
        (window.matchMedia?.("(min-width: 1024px)")?.matches ?? false);
      const hasNativeVT =
        typeof document !== "undefined" &&
        typeof (document as Document & { startViewTransition?: unknown }).startViewTransition ===
          "function";
      const prefersReduced =
        typeof window !== "undefined" &&
        (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false);

      if (!direction || !hasNativeVT || prefersReduced) {
        runRouterNav();
        return;
      }

      flushPendingTransition();
      try {
        activeVtRef.current?.skipTransition?.();
      } catch {
        // Ignore if already settled
      }

      lastNavTargetRef.current = targetPath;

      const handle = startTypedViewTransition(
        isDesktopViewport ? [direction] : ["route-mobile"],
        () => {
          return new Promise<void>((resolve) => {
            pendingResolverRef.current = resolve;
            // Hard upper bound so an uncached route never freezes a 120Hz viewport
            pendingTimerRef.current = window.setTimeout(() => {
              pendingTimerRef.current = null;
              if (pendingResolverRef.current === resolve) {
                pendingResolverRef.current = null;
                resolve();
              }
            }, 64);
            runRouterNav();
          });
        },
        { kind: "route" },
      );

      activeVtRef.current = handle;
      handle?.finished
        ?.then(() => {
          if (activeVtRef.current === handle) {
            activeVtRef.current = null;
          }
          const main = document.getElementById("main-content");
          if (main instanceof HTMLElement && lastNavTargetRef.current === targetPath) {
            const active = document.activeElement;
            if (!active || active === document.body || !main.contains(active)) {
              main.focus({ preventScroll: true });
            }
          }
        })
        .catch(() => {
          if (activeVtRef.current === handle) {
            activeVtRef.current = null;
          }
        });
    },
    [pathname, router, flushPendingTransition],
  );

  const push = useCallback(
    (href: string, options?: NavigateOptions) => {
      navigateWithTransition(href, { ...options, replace: false });
    },
    [navigateWithTransition],
  );

  const replace = useCallback(
    (href: string, options?: Omit<NavigateOptions, "replace">) => {
      navigateWithTransition(href, { ...options, replace: true });
    },
    [navigateWithTransition],
  );

  const value = useMemo(
    () => ({ push, replace, prefetchRoute, isPending }),
    [push, replace, prefetchRoute, isPending],
  );

  return (
    <NavigationTransitionContext.Provider value={value}>
      {children}
    </NavigationTransitionContext.Provider>
  );
}

export function useTransitionRouter(): NavigationTransitionContextValue {
  return useContext(NavigationTransitionContext);
}

export type TransitionLinkProps = LinkProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    children?: React.ReactNode;
  };

/**
 * Drop-in replacement for Next.js `<Link>` that prefetches routes/data on intent
 * and coordinates directional same-document View Transitions.
 */
export const TransitionLink = React.forwardRef<HTMLAnchorElement, TransitionLinkProps>(
  function TransitionLink(
    {
      href,
      replace,
      scroll,
      prefetch = true,
      onClick,
      onMouseEnter,
      onFocus,
      onTouchStart,
      target,
      download,
      ...rest
    },
    ref,
  ) {
    const { push, replace: replaceNav, prefetchRoute } = useTransitionRouter();
    const hrefString = useMemo(() => resolveHrefString(href), [href]);

    const handleWarmIntent = useCallback(() => {
      if (hrefString.startsWith("/") && !hrefString.startsWith("//")) {
        prefetchRoute(hrefString);
      }
    }, [hrefString, prefetchRoute]);

    const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
      onClick?.(e);
      if (e.defaultPrevented) return;
      if (isModifiedMouseClick(e)) return;
      if (target === "_blank" || download !== undefined) return;
      if (!hrefString.startsWith("/") || hrefString.startsWith("//")) return;

      e.preventDefault();
      if (replace) {
        replaceNav(hrefString, { scroll });
      } else {
        push(hrefString, { scroll });
      }
    };

    return (
      <Link
        ref={ref}
        href={href}
        replace={replace}
        scroll={scroll}
        prefetch={prefetch}
        target={target}
        download={download}
        onClick={handleClick}
        onMouseEnter={(e) => {
          onMouseEnter?.(e);
          handleWarmIntent();
        }}
        onFocus={(e) => {
          onFocus?.(e);
          handleWarmIntent();
        }}
        onTouchStart={(e) => {
          onTouchStart?.(e);
          handleWarmIntent();
        }}
        {...rest}
      />
    );
  },
);
