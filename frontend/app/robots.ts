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
          "/favicon.ico",
          "/favicon.png",
          "/icon-192.png",
          "/icon-512.png",
          "/apple-touch-icon.png",
          "/manifest.webmanifest",
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
          "/favicon.ico",
          "/favicon.png",
          "/icon-192.png",
          "/icon-512.png",
          "/apple-touch-icon.png",
          "/manifest.webmanifest",
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
        userAgent: "Googlebot-Image",
        allow: [
          "/favicon.ico",
          "/favicon.png",
          "/icon-192.png",
          "/icon-512.png",
          "/apple-touch-icon.png",
          "/og-image.png",
          "/_next/static/",
        ],
        disallow: [
          "/admin",
          "/admin/*",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
