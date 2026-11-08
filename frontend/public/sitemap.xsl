<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="2.0"
  xmlns:html="http://www.w3.org/TR/REC-html40"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:output method="html" version="1.0" encoding="UTF-8" indent="yes"/>
  <xsl:template match="/">
    <html xmlns="http://www.w3.org/1999/xhtml" lang="uk">
      <head>
        <title>XML Sitemap | Розклад занять ДФКР</title>
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style type="text/css">
          :root {
            --bg: #0b1120;
            --card-bg: #111827;
            --border: #1f2937;
            --text-primary: #f9fafb;
            --text-secondary: #9ca3af;
            --accent: #38bdf8;
            --accent-bg: rgba(56, 189, 248, 0.1);
          }
          @media (prefers-color-scheme: light) {
            :root {
              --bg: #f8fafc;
              --card-bg: #ffffff;
              --border: #e2e8f0;
              --text-primary: #0f172a;
              --text-secondary: #64748b;
              --accent: #0284c7;
              --accent-bg: rgba(2, 132, 199, 0.08);
            }
          }
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: var(--bg);
            color: var(--text-primary);
            padding: 24px 16px;
            line-height: 1.5;
          }
          .container {
            max-width: 1200px;
            margin: 0 auto;
          }
          .header {
            background-color: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          }
          .badge {
            display: inline-block;
            background: var(--accent-bg);
            color: var(--accent);
            font-weight: 700;
            font-size: 11px;
            padding: 3px 8px;
            border-radius: 6px;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            margin-bottom: 8px;
          }
          h1 {
            font-size: 24px;
            font-weight: 800;
            margin-bottom: 6px;
          }
          p.desc {
            font-size: 13px;
            color: var(--text-secondary);
          }
          .stats {
            margin-top: 12px;
            font-size: 12px;
            color: var(--text-secondary);
            font-weight: 600;
          }
          .table-card {
            background-color: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: 16px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
          }
          table {
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
            text-align: left;
          }
          th {
            background-color: var(--card-bg);
            color: var(--text-secondary);
            font-weight: 700;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            padding: 12px 16px;
            border-bottom: 1px solid var(--border);
          }
          td {
            padding: 12px 16px;
            border-bottom: 1px solid var(--border);
            word-break: break-all;
          }
          tr:last-child td {
            border-bottom: none;
          }
          tr:hover td {
            background-color: var(--accent-bg);
          }
          a {
            color: var(--accent);
            text-decoration: none;
            font-weight: 500;
          }
          a:hover {
            text-decoration: underline;
          }
          .pill {
            display: inline-block;
            font-size: 11px;
            font-weight: 600;
            padding: 2px 8px;
            border-radius: 12px;
            background: var(--accent-bg);
            color: var(--accent);
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">ДФКР · SEO</span>
            <h1>XML Карта сайту (Sitemap)</h1>
            <p class="desc">
              Цей файл створений для індексації сторінок коледжу пошуковими роботами (Google, Bing).
            </p>
            <div class="stats">
              Усього індексованих сторінок у файлі: <xsl:value-of select="count(sitemap:urlset/sitemap:url)"/>
            </div>
          </div>
          <div class="table-card">
            <table>
              <thead>
                <tr>
                  <th style="width: 55%;">Адреса сторінки (URL)</th>
                  <th style="width: 15%;">Пріоритет</th>
                  <th style="width: 15%;">Частота</th>
                  <th style="width: 15%;">Оновлено</th>
                </tr>
              </thead>
              <tbody>
                <xsl:for-each select="sitemap:urlset/sitemap:url">
                  <tr>
                    <td>
                      <xsl:variable name="itemURL">
                        <xsl:value-of select="sitemap:loc"/>
                      </xsl:variable>
                      <a href="{$itemURL}" target="_blank">
                        <xsl:value-of select="sitemap:loc"/>
                      </a>
                    </td>
                    <td>
                      <span class="pill">
                        <xsl:value-of select="sitemap:priority"/>
                      </span>
                    </td>
                    <td style="color: var(--text-secondary);">
                      <xsl:value-of select="sitemap:changefreq"/>
                    </td>
                    <td style="color: var(--text-secondary); font-size: 12px;">
                      <xsl:value-of select="substring(sitemap:lastmod, 0, 11)"/>
                    </td>
                  </tr>
                </xsl:for-each>
              </tbody>
            </table>
          </div>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
