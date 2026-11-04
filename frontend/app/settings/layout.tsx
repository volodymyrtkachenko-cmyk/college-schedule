import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Налаштування розкладу",
  description: "Персональні налаштування застосунку розкладу ДФКР: тема оформлення, вибір підгрупи, сповіщення та Classroom.",
  alternates: {
    canonical: "/settings",
  },
  robots: {
    index: false,
    follow: true,
  },
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
