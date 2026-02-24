import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Sora", "system-ui", "sans-serif"],
        body: ["Source Sans 3", "system-ui", "sans-serif"],
      },
      colors: {
        ink: "#0f172a",
        muted: "#475569",
        mist: "#e2e8f0",
        sea: "#0f766e",
        seaLight: "#14b8a6",
        sand: "#f59e0b",
        paper: "#f8fafc",
      },
      boxShadow: {
        card: "0 10px 30px -18px rgba(15, 23, 42, 0.45)",
      },
      backgroundImage: {
        "hero-gradient": "radial-gradient(circle at top left, rgba(20,184,166,0.22), transparent 55%), radial-gradient(circle at 30% 20%, rgba(245,158,11,0.18), transparent 50%), linear-gradient(135deg, #f8fafc 0%, #eef2ff 40%, #f1f5f9 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
