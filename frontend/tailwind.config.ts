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
          bg: '#080310',
          card: '#150A22',
          border: '#25173B',
          input: '#040108',
          tabActive: '#201035',
          destructive: '#F87171',
          accent: '#B464F5',
          text: {
            subject: '#FFFFFF',
            primary: '#F9FAFB',
            secondary: '#A299AD',
            muted: '#6B5E7D',
          }
        }
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
