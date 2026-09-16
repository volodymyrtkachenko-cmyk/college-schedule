import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth";

export const metadata: Metadata = {
  title: "Розклад коледжу",
  description: "Актуальний розклад занять коледжу",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Розклад",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  }
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  colorScheme: "dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body><AuthProvider>{children}</AuthProvider></body>
    </html>
  );
}
