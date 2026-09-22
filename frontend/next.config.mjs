import withPWAInit from "@ducanh2912/next-pwa";

const withPwa = withPWAInit({
  dest: "public",
  register: true,
  skipWaiting: true,
  cacheOnFrontEndNav: true,
  cacheStartUrl: true,
  disable: process.env.NODE_ENV === "development",
  fallbacks: {
    document: "/~offline"
  }
});

/** @type {import('next').NextConfig} */
const nextConfig = { output: "standalone" };

export default withPwa(nextConfig);
