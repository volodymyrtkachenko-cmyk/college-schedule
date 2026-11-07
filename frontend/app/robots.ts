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
          "/bells",
          "/group/",
          "/teacher/",
          "/educational-process",
          "/statistics",
          "/_next/static/",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/login",
          "/settings",
          "/settings/*",
          "/*?*tab=",
          "/~offline",
          "/api/*",
        ],
      },
      {
        userAgent: "Googlebot",
        allow: [
          "/",
          "/bells",
          "/group/",
          "/teacher/",
          "/educational-process",
          "/statistics",
          "/_next/static/",
        ],
        disallow: [
          "/admin",
          "/admin/*",
          "/login",
          "/settings",
          "/settings/*",
          "/*?*tab=",
          "/~offline",
          "/api/*",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
