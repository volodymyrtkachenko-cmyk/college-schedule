export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://rozklad-dfkr.pp.ua";

export const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return "rozklad-dfkr.pp.ua";
  }
})();

export const BACKEND_API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://my-college-schedule-api-8ffebe58b2b9.herokuapp.com";

export const PROD_API_URL = BACKEND_API_URL;

