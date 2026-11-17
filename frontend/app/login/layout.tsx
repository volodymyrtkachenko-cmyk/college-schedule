import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Вхід у систему",
  description: "Авторизація адміністратора або редактора розкладу занять ДФКР.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
