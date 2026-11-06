export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL || "https://college-schedule-flame.vercel.app";

export const SITE_HOST = (() => {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return "college-schedule-flame.vercel.app";
  }
})();
