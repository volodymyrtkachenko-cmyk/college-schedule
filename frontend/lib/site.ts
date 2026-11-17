const rawSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
const isDev = process.env.NODE_ENV === "development";

// Захист від випадкового потрапляння технічного домену .vercel.app або localhost у Sitemap та канонічні посилання
export const SITE_URL =
  rawSiteUrl && !rawSiteUrl.includes("vercel.app") && (!rawSiteUrl.includes("localhost") || isDev)
    ? rawSiteUrl
    : isDev
      ? "http://localhost:3000"
      : "https://rozklad-dfkr.pp.ua";

export const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return isDev ? "localhost" : "rozklad-dfkr.pp.ua";
  }
})();

export const PROD_API_URL =
  "https://my-college-schedule-api-8ffebe58b2b9.herokuapp.com";

export const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") ||
  (isDev ? "http://localhost:8000" : PROD_API_URL);
