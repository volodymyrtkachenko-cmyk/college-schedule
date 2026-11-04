import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://college-schedule-flame.vercel.app";

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/educational-process",
          "/statistics",
          "/settings",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/login",
          "/~offline",
          "/api/*",
          "/_next/*",
        ],
      },
      {
        userAgent: "Googlebot",
        allow: [
          "/",
          "/educational-process",
          "/statistics",
          "/settings",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/login",
          "/~offline",
          "/api/*",
          "/_next/*",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
