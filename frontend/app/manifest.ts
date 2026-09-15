import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Розклад коледжу",
    short_name: "Розклад",
    description: "Актуальний розклад занять коледжу",
    start_url: "/",
    display: "standalone",
    background_color: "#020617",
    theme_color: "#020617",
    lang: "uk",
    icons: [
      { src: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "maskable" },
      { src: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "maskable" }
    ]
  };
}
