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
        ink: "#0b1f14",
        muted: "#355446",
        mist: "#cfe6d9",
        sea: "#0c6f3d",
        seaLight: "#34d399",
        sand: "#dff7ea",
        paper: "#f3fbf6",
      },
      boxShadow: {
        card: "0 10px 30px -18px rgba(11, 31, 20, 0.35)",
      },
      backgroundImage: {
        "hero-gradient":
          "radial-gradient(circle at top left, rgba(12,111,61,0.28), transparent 55%), radial-gradient(circle at 25% 15%, rgba(52,211,153,0.28), transparent 60%), radial-gradient(circle at 80% 10%, rgba(223,247,234,0.45), transparent 55%), linear-gradient(135deg, #f1faf5 0%, #e0f4ea 45%, #f2fbf6 100%)",
      },
    },
  },
  plugins: [],
} satisfies Config;
