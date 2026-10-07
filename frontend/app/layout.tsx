import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "../lib/auth";
import { Heartbeat } from "../components/Heartbeat";

export const metadata: Metadata = {
  title: "Розклад занять | ДФКР",
  description: "Актуальний розклад занять ДФКР для студентів і викладачів.",
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
  themeColor: "#0D1117",
  colorScheme: "dark"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="uk">
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body>
        <AuthProvider>
          <Heartbeat />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
