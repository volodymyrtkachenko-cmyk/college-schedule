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
          bg: '#0D1117',
          card: '#161B22',
          border: '#21262D',
          input: '#010409',
          tabActive: '#21262D',
          destructive: '#F85149',
          accent: '#1F6FEB',
          neon: '#00E5FF',
          warning: '#FFD600',
          warningText: '#0D1117',
          text: {
            subject: '#FFFFFF',
            primary: '#FFFFFF',
            secondary: '#8B949E',
            muted: '#6E7681',
          }
        }
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
