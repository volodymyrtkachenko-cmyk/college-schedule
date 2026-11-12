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
