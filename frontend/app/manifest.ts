import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Розклад занять ДФКР",
    short_name: "Розклад",
    description: "Актуальний розклад занять ДФКР для студентів і викладачів.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0d14",
    theme_color: "#0a0d14",
    lang: "uk",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
