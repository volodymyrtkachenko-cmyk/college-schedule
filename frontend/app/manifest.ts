import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Розклад ДФКР",
    short_name: "Розклад ДФКР",
    description: "Актуальний розклад занять ДФКР для студентів і викладачів.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#080d18",
    theme_color: "#080d18",
    lang: "uk",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      {
        name: "Розклад на сьогодні",
        short_name: "Сьогодні",
        description: "Переглянути розклад занять на сьогодні",
        url: "/",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Завдання Classroom",
        short_name: "Завдання",
        description: "Переглянути домашні завдання та борги",
        url: "/?tab=tasks",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
  };
}
