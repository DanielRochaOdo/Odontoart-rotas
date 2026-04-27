import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Circular", "Avenir Next", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        body: ["Circular", "Avenir Next", "Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        mono: ["Source Code Pro", "Menlo", "Consolas", "monospace"],
      },
      colors: {
        ink: "rgb(var(--color-ink) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        mist: "rgb(var(--color-mist) / <alpha-value>)",
        sea: "rgb(var(--color-sea) / <alpha-value>)",
        seaLight: "rgb(var(--color-seaLight) / <alpha-value>)",
        sand: "rgb(var(--color-sand) / <alpha-value>)",
        paper: "rgb(var(--color-paper) / <alpha-value>)",
      },
      boxShadow: {
        card: "0 8px 24px -18px rgba(16, 33, 26, 0.26)",
      },
      backgroundImage: {
        "hero-gradient":
          "radial-gradient(circle at 12% 8%, rgba(62, 207, 142, 0.16), transparent 42%), radial-gradient(circle at 88% 0%, rgba(0, 197, 115, 0.12), transparent 40%), linear-gradient(135deg, #f6faf7 0%, #eef5f1 48%, #f9fcfa 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
