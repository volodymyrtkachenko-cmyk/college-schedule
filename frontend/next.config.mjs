import withPWA from "next-pwa";

const withPwa = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  disable: process.env.NODE_ENV === "development",
  runtimeCaching: [
    {
      // 1. Explicitly cache HTML pages (like "/")
      urlPattern: ({ request, url }) => request.destination === "document" || url.pathname === "/",
      handler: "NetworkFirst",
      options: {
        cacheName: "html-pages",
        networkTimeoutSeconds: 5,
        expiration: { maxEntries: 10, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] }
      }
    },
    {
      // 2. Cache Next.js / API calls
      urlPattern: /^https?:\/\/.*\/api\/.*/i,
      handler: "NetworkFirst",
      options: {
        cacheName: "full-api-v1",
        networkTimeoutSeconds: 15,
        expiration: { maxEntries: 50, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] }
      }
    },
    {
      // 3. Cache Next.js static chunks
      urlPattern: /^https?:\/\/.*\/_next\/static\/.*/i,
      handler: "CacheFirst",
      options: {
        cacheName: "next-static-v1",
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] }
      }
    },
    {
      // 4. Cache Images/Icons
      urlPattern: /\.(?:png|svg|ico|webp|jpg|jpeg|gif|woff2?|webmanifest)$/i,
      handler: "CacheFirst",
      options: {
        cacheName: "static-assets-v1",
        expiration: { maxEntries: 100, maxAgeSeconds: 30 * 24 * 60 * 60 },
        cacheableResponse: { statuses: [0, 200] }
      }
    }
  ]
});

/** @type {import('next').NextConfig} */
const nextConfig = { output: "standalone" };

export default withPwa(nextConfig);
