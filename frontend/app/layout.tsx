import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  title: "Розклад коледжу",
  description: "Актуальний розклад занять коледжу",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#020617",
  colorScheme: "dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
