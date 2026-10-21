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
          bg: '#0B0B0E',
          card: '#14141A',
          surface: '#14141A',
          hover: '#1B1B22',
          elevated: '#1B1B22',
          elevatedBorder: '#3F3F46',
          border: '#23232B',
          borderSubtle: '#23232B',
          borderStrong: '#3F3F46',
          input: '#0B0B0E',
          tabActive: 'rgba(59, 130, 246, 0.12)',
          destructive: '#F87171',
          danger: '#F87171',
          accent: '#3B82F6',
          accentHover: '#2563EB',
          accentSubtle: 'rgba(59, 130, 246, 0.12)',
          success: '#34D399',
          warning: '#FBBF24',
          warningText: '#000000',
          text: {
            subject: '#FAFAFA',
            primary: '#FAFAFA',
            secondary: '#A1A1AA',
            tertiary: '#8E8E99',
            muted: '#8E8E99',
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
