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
          bg: '#29132e', // Very dark violet background
          card: '#321450', // Dark violet for cards
          border: '#6b3294', // Lighter purple for card borders!
          input: '#1d0c22',
          tabActive: '#4a1b7a',
          destructive: '#de004e',
          accent: '#f887ff', // Bright neon pink header and badges
          text: {
            subject: '#FFFFFF',
            primary: '#FDF4FF',
            secondary: '#e5b3fe', // Lighter purple-pink for secondary text
            muted: '#c780e8',
          }
        }
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
