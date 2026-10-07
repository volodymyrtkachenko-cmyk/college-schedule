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
          border: '#30363D', // GitHub border color
          input: '#010409', // GitHub darker bg
          tabActive: '#21262D',
          destructive: '#F85149', // GitHub red
          accent: '#58A6FF', // GitHub blue
          warning: '#D29922', // Amber for 'ЗАМІНА'
          text: {
            subject: '#E6EDF3', // Clean white
            primary: '#E6EDF3',
            secondary: '#8B949E', // Muted gray
            muted: '#6E7681', // Even darker gray
          }
        }
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
