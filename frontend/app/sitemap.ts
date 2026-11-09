import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { toTeacherSlug } from "../lib/slug";
import { fetchDirectoryForSsr } from "../lib/ssrApi";

export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = SITE_URL;
  const now = new Date();

  const { groups, teachers } = await fetchDirectoryForSsr();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${siteUrl}/bells`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.9,
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

  const groupRoutes: MetadataRoute.Sitemap = groups.map((g) => ({
    url: `${siteUrl}/group/${encodeURIComponent(g.name)}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.85,
  }));

  const teacherRoutes: MetadataRoute.Sitemap = teachers.map((t) => ({
    url: `${siteUrl}/teacher/${toTeacherSlug(t.name)}`,
    lastModified: now,
    changeFrequency: "daily",
    priority: 0.8,
  }));

  return [...staticRoutes, ...groupRoutes, ...teacherRoutes];
}
