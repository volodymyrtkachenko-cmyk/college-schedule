import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Налаштування",
  description: "Персональні налаштування розкладу ДФКР: вибір групи, підгрупи, теми оформлення та інтеграції з Google Classroom.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
