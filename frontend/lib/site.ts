const rawSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");

// Захист від випадкового потрапляння технічного домену .vercel.app або localhost у Sitemap та канонічні посилання
export const SITE_URL =
  rawSiteUrl && !rawSiteUrl.includes("vercel.app") && !rawSiteUrl.includes("localhost")
    ? rawSiteUrl
    : "https://rozklad-dfkr.pp.ua";

export const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return "rozklad-dfkr.pp.ua";
  }
})();

export const PROD_API_URL =
  "https://my-college-schedule-api-8ffebe58b2b9.herokuapp.com";

export const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_API_URL?.trim().replace(/\/+$/, "") || PROD_API_URL;
