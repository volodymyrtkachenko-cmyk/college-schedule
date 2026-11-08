import { NextResponse } from "next/server";
import { SITE_URL } from "../../lib/site";
import { toTeacherSlug } from "../../lib/slug";
import { fetchDirectoryForSsr } from "../../lib/ssrApi";

export const dynamic = "force-dynamic";
export const revalidate = 86400; // 24 hours

export async function GET() {
  const siteUrl = SITE_URL;
  const now = new Date().toISOString();

  const { groups, teachers } = await fetchDirectoryForSsr();

  const staticUrls = [
    { loc: `${siteUrl}/`, changefreq: "daily", priority: "1.0" },
    { loc: `${siteUrl}/bells`, changefreq: "monthly", priority: "0.9" },
    { loc: `${siteUrl}/educational-process`, changefreq: "weekly", priority: "0.8" },
    { loc: `${siteUrl}/statistics`, changefreq: "weekly", priority: "0.7" },
  ];

  const groupUrls = groups.map((g) => ({
    loc: `${siteUrl}/group/${encodeURIComponent(g.name)}`,
    changefreq: "daily",
    priority: "0.85",
  }));

  const teacherUrls = teachers.map((t) => ({
    loc: `${siteUrl}/teacher/${toTeacherSlug(t.name)}`,
    changefreq: "daily",
    priority: "0.8",
  }));

  const allUrls = [...staticUrls, ...groupUrls, ...teacherUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<?xml-stylesheet type="text/xsl" href="/sitemap.xsl"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls
  .map(
    (u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${now}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`
  )
  .join("\n")}
</urlset>`;

  return new NextResponse(xml, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=43200",
    },
  });
}
