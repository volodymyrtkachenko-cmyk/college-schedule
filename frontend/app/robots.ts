import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = SITE_URL;

  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/educational-process",
          "/statistics",
          "/_next/static/",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/login",
          "/~offline",
          "/api/*",
        ],
      },
      {
        userAgent: "Googlebot",
        allow: [
          "/",
          "/educational-process",
          "/statistics",
          "/_next/static/",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/login",
          "/~offline",
          "/api/*",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
