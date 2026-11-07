import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth";
import { Heartbeat } from "../components/Heartbeat";
import { ToastProvider } from "../components/ToastProvider";
import { ThemeProvider } from "../lib/useTheme";
import { MotionConfigProvider } from "../components/MotionConfigProvider";
import { MobileNavProvider } from "../lib/useMobileNav";
import { BottomNav } from "../components/BottomNav";
import { SITE_URL } from "../lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Розклад ДФКР — Розклад занять Дніпровського фахового коледжу радіоелектроніки",
    template: "%s | Розклад ДФКР",
  },
  description: "Розклад ДФКР: актуальний електронний розклад занять Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ) для студентів і викладачів. Розклад пар на сьогодні та тиждень, розклад дзвінків, аудиторії, жива пара та завдання Google Classroom.",
  keywords: [
    "розклад ДФКР",
    "ДФКР розклад",
    "розклад занять ДФКР",
    "ДФКР",
    "КРЕ",
    "ДКРЕ",
    "розклад КРЕ",
    "розклад ДКРЕ",
    "розклад занять КРЕ Дніпро",
    "Дніпровський фаховий коледж радіоелектроніки",
    "Дніпровський коледж радіоелектроніки розклад",
    "розклад дзвінків ДФКР",
    "електронний розклад ДФКР",
    "студентський розклад ДФКР",
    "пари ДФКР",
    "kre.dp.ua розклад",
    "Google Classroom ДФКР",
  ],
  authors: [{ name: "ДФКР" }],
  creator: "ДФКР",
  publisher: "Дніпровський фаховий коледж радіоелектроніки",
  alternates: {
    canonical: "/",
  },
  manifest: "/manifest.webmanifest",
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || "googlec5560073f40db86d",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Розклад ДФКР",
  },
  openGraph: {
    type: "website",
    locale: "uk_UA",
    url: "/",
    siteName: "Розклад ДФКР",
    title: "Розклад ДФКР — Розклад занять Дніпровського фахового коледжу радіоелектроніки",
    description: "Розклад ДФКР: електронний розклад занять для студентів та викладачів, жива пара, розклад дзвінків, аудиторії та Google Classroom.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Розклад ДФКР — Дніпровський фаховий коледж радіоелектроніки",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Розклад ДФКР — Розклад занять Дніпровського фахового коледжу радіоелектроніки",
    description: "Розклад ДФКР: жива пара, розклад дзвінків, аудиторії та завдання Google Classroom.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "48x48", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0d14" },
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
  ],
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      "url": `${SITE_URL}/`,
      "name": "Розклад ДФКР",
      "alternateName": [
        "Розклад занять ДФКР",
        "ДФКР розклад",
        "Розклад КРЕ",
        "Розклад ДКРЕ",
        "Розклад занять Дніпровського фахового коледжу радіоелектроніки",
      ],
      "description": "Розклад ДФКР — актуальний електронний розклад занять Дніпровського фахового коледжу радіоелектроніки для студентів і викладачів",
      "inLanguage": "uk-UA",
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#webapp`,
      "name": "Розклад ДФКР",
      "url": `${SITE_URL}/`,
      "applicationCategory": "EducationalApplication",
      "operatingSystem": "All",
      "browserRequirements": "Requires JavaScript. Requires HTML5.",
      "description": "Сучасний веб-застосунок (PWA) розкладу занять, дзвінків та завдань Google Classroom для студентів і викладачів ДФКР (КРЕ).",
      "offers": {
        "@type": "Offer",
        "price": "0",
        "priceCurrency": "UAH",
      },
    },
    {
      "@type": "EducationalOrganization",
      "@id": "https://kre.dp.ua/#organization",
      "name": "Дніпровський фаховий коледж радіоелектроніки",
      "alternateName": [
        "ДФКР",
        "КРЕ",
        "ДКРЕ",
        "Дніпровський коледж радіоелектроніки",
      ],
      "url": "https://kre.dp.ua/",
      "sameAs": [
        "https://kre.dp.ua/",
      ],
      "logo": `${SITE_URL}/icon-512.png`,
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Дніпро",
        "addressCountry": "UA",
      },
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE_URL}/#faq`,
      "mainEntity": [
        {
          "@type": "Question",
          "name": "Який розклад дзвінків у ДФКР (КРЕ)?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Стандартний розклад дзвінків ДФКР: 1 пара: 09:00–10:20 (перерва 20 хв), 2 пара: 10:40–12:00 (велика перерва 30 хв), 3 пара: 12:30–13:50 (перерва 10 хв), 4 пара: 14:00–15:20. У скорочені дні пари тривають по 50 хвилин з перервами по 10 хвилин.",
          },
        },
        {
          "@type": "Question",
          "name": "Де подивитися актуальний розклад занять груп та викладачів ДФКР?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Актуальний електронний розклад усіх груп 1–4 курсів та викладачів Дніпровського фахового коледжу радіоелектроніки (ДФКР / КРЕ) доступний онлайн у веб-застосунку з автоматичним оновленням замін, кабінетів, чисельника/знаменника та відстеженням живої пари.",
          },
        },
        {
          "@type": "Question",
          "name": "Як підключити Google Classroom та онлайн-пари Meet або Zoom?",
          "acceptedAnswer": {
            "@type": "Answer",
            "text": "Після вибору своєї групи в розкладі ДФКР натисніть кнопку синхронізації Google Classroom. Система автоматично підтягне домашні завдання, дедлайни, оцінки та прямі посилання на онлайн-заняття у Google Meet або Zoom.",
          },
        },
      ],
    },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_API_URL || "https://backend-agile-driftwood-8589.fly.dev"} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_API_URL || "https://backend-agile-driftwood-8589.fly.dev"} />
        <link rel="preconnect" href="https://accounts.google.com" />
        <link rel="dns-prefetch" href="https://accounts.google.com" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                var stored = localStorage.getItem('college_theme');
                var mql = window.matchMedia('(prefers-color-scheme: dark)');
                var theme = (stored === 'light' || stored === 'dark') ? stored : (mql.matches ? 'dark' : 'light');
                document.documentElement.classList.add(theme);
                document.documentElement.setAttribute('data-theme', theme);
                var storedAccent = localStorage.getItem('college_accent') || 'blue';
                document.documentElement.setAttribute('data-accent', storedAccent);
              } catch (e) {}

              try {
                window.addEventListener('beforeinstallprompt', function(e) {
                  e.preventDefault();
                  window.__pwaInstallEvent = e;
                  window.dispatchEvent(new CustomEvent('pwa-install-ready', { detail: e }));
                });
                window.addEventListener('appinstalled', function() {
                  window.__pwaInstallEvent = null;
                  window.dispatchEvent(new CustomEvent('pwa-installed'));
                });
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body>
        <a href="#main-content" className="skip-link">
          Перейти до розкладу
        </a>
        <noscript>
          <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
            <h1>Розклад занять Дніпровського фахового коледжу радіоелектроніки (ДФКР)</h1>
            <p>Актуальний розклад занять для студентів та викладачів коледжу.</p>
            <h2>Розклад дзвінків</h2>
            <ul>
              <li><strong>1 пара:</strong> 09:00 – 10:20 (перерва 20 хв)</li>
              <li><strong>2 пара:</strong> 10:40 – 12:00 (перерва 30 хв)</li>
              <li><strong>3 пара:</strong> 12:30 – 13:50 (перерва 10 хв)</li>
              <li><strong>4 пара:</strong> 14:00 – 15:20</li>
            </ul>
            <h2>Розділи застосунку</h2>
            <ul>
              <li><a href="/">Розклад занять на сьогодні та тиждень</a></li>
              <li><a href="/educational-process">Графік освітнього процесу</a></li>
              <li><a href="/statistics">Статистика занять та навантаження</a></li>
              <li><a href="/settings">Налаштування розкладу</a></li>
              <li><a href="https://kre.dp.ua/" target="_blank" rel="noopener noreferrer">Офіційний сайт ДФКР</a></li>
            </ul>
            <p>Для повноцінної роботи PWA-застосунку, відстеження живої пари та синхронізації Classroom, будь ласка, увімкніть JavaScript у браузері.</p>
          </div>
        </noscript>
        <ThemeProvider>
          <MotionConfigProvider>
            <AuthProvider>
              <ToastProvider>
                <MobileNavProvider>
                  <Heartbeat />
                  {children}
                  <BottomNav />
                </MobileNavProvider>
              </ToastProvider>
            </AuthProvider>
          </MotionConfigProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
