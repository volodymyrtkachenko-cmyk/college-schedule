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
          accentSolid: 'rgb(var(--sys-accent-solid) / <alpha-value>)',
          onAccent: 'rgb(var(--sys-on-accent) / <alpha-value>)',
          success: 'rgb(var(--sys-success) / <alpha-value>)',
          info: 'rgb(var(--sys-info) / <alpha-value>)',
          neon: 'rgb(var(--sys-neon) / <alpha-value>)',
          warning: 'rgb(var(--sys-warning) / <alpha-value>)',
          warningText: 'rgb(var(--sys-warning-text) / <alpha-value>)',
          status: {
            okText: 'rgb(var(--sys-status-ok-text) / <alpha-value>)',
            okBg: 'rgb(var(--sys-status-ok-bg) / <alpha-value>)',
            warnText: 'rgb(var(--sys-status-warn-text) / <alpha-value>)',
            warnBg: 'rgb(var(--sys-status-warn-bg) / <alpha-value>)',
            dangerText: 'rgb(var(--sys-status-danger-text) / <alpha-value>)',
            dangerBg: 'rgb(var(--sys-status-danger-bg) / <alpha-value>)',
            infoText: 'rgb(var(--sys-status-info-text) / <alpha-value>)',
            infoBg: 'rgb(var(--sys-status-info-bg) / <alpha-value>)',
            denomText: 'rgb(var(--sys-status-denom-text) / <alpha-value>)',
            denomBg: 'rgb(var(--sys-status-denom-bg) / <alpha-value>)',
            neutralText: 'rgb(var(--sys-status-neutral-text) / <alpha-value>)',
            neutralBg: 'rgb(var(--sys-status-neutral-bg) / <alpha-value>)',
          },
          text: {
            subject: 'rgb(var(--sys-text-subject) / <alpha-value>)',
            primary: 'rgb(var(--sys-text-primary) / <alpha-value>)',
            secondary: 'rgb(var(--sys-text-secondary) / <alpha-value>)',
            muted: 'rgb(var(--sys-text-muted) / <alpha-value>)',
          }
        }
      },
      transitionDuration: {
        fast: '120ms',
        base: '200ms',
        slow: '280ms',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.2, 0, 0, 1)',
        easeOut: 'cubic-bezier(0.4, 0, 1, 1)',
      }
    }
  },
  plugins: [require("tailwindcss-animate")]
};

export default config;
