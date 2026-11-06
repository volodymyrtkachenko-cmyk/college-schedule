import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = SITE_URL;
  const now = new Date();

  return [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${siteUrl}/educational-process`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/statistics`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];
}
