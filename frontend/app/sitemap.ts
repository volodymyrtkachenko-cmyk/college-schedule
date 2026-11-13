import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/site";
import { toTeacherSlug } from "../lib/slug";
import { fetchDirectoryForSsr } from "../lib/ssrApi";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = SITE_URL.replace(/\/+$/, "");
  const todayIso = new Date().toISOString().split("T")[0];

  const { groups, teachers } = await fetchDirectoryForSsr(0);

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
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${siteUrl}/groups`,
      lastModified: todayIso,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${siteUrl}/teachers`,
      lastModified: todayIso,
      changeFrequency: "daily",
      priority: 0.8,
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

  // Дедуплікація всіх URL за ключем url, щоб уникнути помилки дублів у Google Search Console
  const uniqueByUrl = new Map<string, MetadataRoute.Sitemap[number]>();
  for (const entry of [...staticRoutes, ...groupRoutes, ...teacherRoutes]) {
    if (!uniqueByUrl.has(entry.url)) {
      uniqueByUrl.set(entry.url, entry);
    }
  }

  return Array.from(uniqueByUrl.values());
}
