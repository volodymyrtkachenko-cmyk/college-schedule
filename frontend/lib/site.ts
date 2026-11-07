export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://rozklad-dfkr.pp.ua";

export const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return "rozklad-dfkr.pp.ua";
  }
})();
