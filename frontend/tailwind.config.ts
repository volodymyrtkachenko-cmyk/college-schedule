import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sys: {
          bg: '#000000',
          card: '#121214',
          surface: '#121214',
          elevated: '#18181B',
          elevatedBorder: '#3F3F46',
          border: '#27272A',
          input: '#09090B',
          tabActive: '#18181B',
          destructive: '#EF4444',
          accent: '#3B82F6',
          success: '#10B981',
          info: '#8B5CF6',
          neon: '#3B82F6',
          warning: '#F59E0B',
          warningText: '#000000',
          text: {
            subject: '#FFFFFF',
            primary: '#F4F4F5',
            secondary: '#A1A1AA',
            muted: '#71717A',
          }
        }
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.2, 0, 0, 1)',
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
