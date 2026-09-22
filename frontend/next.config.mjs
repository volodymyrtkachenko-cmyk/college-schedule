import withPWA from "next-pwa";

const withPwa = withPWA({
  dest: "public",
  register: true,
  skipWaiting: true,
  clientsClaim: true,
  disable: process.env.NODE_ENV === "development",
  // Fallback to the main page when offline!
  fallbacks: {
    document: "/",
  }
});

/** @type {import('next').NextConfig} */
const nextConfig = { output: "standalone" };

export default withPwa(nextConfig);
