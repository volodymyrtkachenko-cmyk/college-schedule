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
          bg: '#0a0d14',
          card: '#121722',
          surface: '#121722',
          elevated: '#182030',
          elevatedBorder: '#28354d',
          border: '#1e2638',
          input: '#0d121c',
          tabActive: '#182030',
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
            secondary: '#94A3B8',
            muted: '#64748B',
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
