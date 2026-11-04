import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Вхід до системи",
  description: "Вхід до панелі керування розкладом для викладачів та адміністраторів коледжу.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
