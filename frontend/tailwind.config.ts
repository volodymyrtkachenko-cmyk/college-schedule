import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        sys: {
          bg: 'rgb(var(--sys-bg) / <alpha-value>)',
          card: 'rgb(var(--sys-card) / <alpha-value>)',
          surface: 'rgb(var(--sys-surface) / <alpha-value>)',
          elevated: 'rgb(var(--sys-elevated) / <alpha-value>)',
          elevatedBorder: 'rgb(var(--sys-elevated-border) / <alpha-value>)',
          border: 'rgb(var(--sys-border) / <alpha-value>)',
          input: 'rgb(var(--sys-input) / <alpha-value>)',
          tabActive: 'rgb(var(--sys-tab-active) / <alpha-value>)',
          destructive: 'rgb(var(--sys-destructive) / <alpha-value>)',
          accent: 'rgb(var(--sys-accent) / <alpha-value>)',
          success: 'rgb(var(--sys-success) / <alpha-value>)',
          info: 'rgb(var(--sys-info) / <alpha-value>)',
          neon: 'rgb(var(--sys-neon) / <alpha-value>)',
          warning: 'rgb(var(--sys-warning) / <alpha-value>)',
          warningText: 'rgb(var(--sys-warning-text) / <alpha-value>)',
          text: {
            subject: 'rgb(var(--sys-text-subject) / <alpha-value>)',
            primary: 'rgb(var(--sys-text-primary) / <alpha-value>)',
            secondary: 'rgb(var(--sys-text-secondary) / <alpha-value>)',
            muted: 'rgb(var(--sys-text-muted) / <alpha-value>)',
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
