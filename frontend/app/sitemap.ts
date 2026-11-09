import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { toTeacherSlug } from "../lib/slug";
import { fetchDirectoryForSsr } from "../lib/ssrApi";

export const revalidate = 3600; // Кешувати Sitemap на 1 годину для миттєвої відповіді Googlebot

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = SITE_URL.replace(/\/+$/, "");
  const todayIso = new Date().toISOString().split("T")[0];

  const { groups, teachers } = await fetchDirectoryForSsr();

  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${siteUrl}/`,
      lastModified: todayIso,
      changeFrequency: "daily",
      priority: 1.0,
    },
    {
      url: `${siteUrl}/bells`,
      lastModified: todayIso,
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/educational-process`,
      lastModified: todayIso,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${siteUrl}/statistics`,
      lastModified: todayIso,
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];

  const groupRoutes: MetadataRoute.Sitemap = groups
    .filter((g) => g.name && g.name.trim())
    .map((g) => ({
      url: `${siteUrl}/group/${encodeURIComponent(g.name.trim())}`,
      lastModified: todayIso,
      changeFrequency: "daily" as const,
      priority: 0.85,
    }));

  const teacherRoutes: MetadataRoute.Sitemap = teachers
    .map((t) => ({
      url: `${siteUrl}/teacher/${toTeacherSlug(t.name)}`,
      lastModified: todayIso,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }))
    .filter((item) => !item.url.endsWith("/teacher/teacher"));

  return [...staticRoutes, ...groupRoutes, ...teacherRoutes];
}
