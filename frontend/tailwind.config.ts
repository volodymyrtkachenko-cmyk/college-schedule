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
          bg: '#29132e', // Very dark violet
          card: '#321450', // Dark violet
          border: '#5c1b6b', // Slightly lighter violet for borders
          input: '#1d0c22', // Darker for inputs
          tabActive: '#481971',
          destructive: '#de004e', // Deep bright pink/red
          accent: '#f887ff', // Bright neon pink/magenta
          text: {
            subject: '#FFFFFF',
            primary: '#FDF4FF', // Light pinkish white
            secondary: '#F5D0FE', // Fuchsia-200
            muted: '#D946EF', // Fuchsia-500
          }
        }
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
