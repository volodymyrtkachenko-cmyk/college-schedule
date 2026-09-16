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
          bg: '#0b1120',
          card: '#131c2e',
          border: '#1e2a42',
          input: '#0a0e18',
          tabActive: '#1a2540',
          destructive: '#e08a8a',
          accent: '#5ecbe8',
          text: {
            subject: '#ffffff',
            primary: '#e7ecf5',
            secondary: '#8b98ad',
            muted: '#5b6b85',
          }
        }
      }
    }
  },
  plugins: []
};

export default config;
