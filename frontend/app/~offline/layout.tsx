import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Офлайн-режим",
  robots: {
    index: false,
    follow: false,
  },
};

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
