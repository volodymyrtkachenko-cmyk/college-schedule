import withPWAInit from "@ducanh2912/next-pwa";

const withPwa = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  cacheStartUrl: true,
  dynamicStartUrl: false, // Мгновенный запуск App Shell из памяти телефона (0 мс ожидания сети)
  reloadOnOnline: false,  // Не перезагружать страницу целиком при переключении Wi-Fi / LTE
  disable: process.env.NODE_ENV === "development",
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    navigationPreload: true,
    runtimeCaching: [
      {
        // Розклад: мережа з таймаутом 3 с, офлайн — з кешу SW (localStorage-кеш застосунку лишається головним)
        urlPattern: ({ url }) => url.pathname.startsWith("/api/schedule") && !url.pathname.startsWith("/api/schedule-versions"),
        handler: "NetworkFirst",
        options: {
          cacheName: "api-schedule",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 60, maxAgeSeconds: 7 * 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Довідники груп/викладачів (публічні GET) змінюються рідко
        urlPattern: ({ url }) => /^\/api\/(groups|teachers)(\/|$)/.test(url.pathname),
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "api-directory",
          expiration: { maxEntries: 20, maxAgeSeconds: 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // Classroom завдання та статуси: спочатку мережа, при офлайні — кеш
        urlPattern: ({ url }) => url.pathname.startsWith("/api/classroom"),
        handler: "NetworkFirst",
        options: {
          cacheName: "api-classroom",
          networkTimeoutSeconds: 3,
          expiration: { maxEntries: 30, maxAgeSeconds: 24 * 60 * 60 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
  fallbacks: {
    document: "/~offline",
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
};

export default withPwa(nextConfig);
