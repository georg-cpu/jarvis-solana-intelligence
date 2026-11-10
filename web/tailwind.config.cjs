/** @type {import('tailwindcss').Config} */
const path = require("path");
module.exports = {
  content: [path.join(__dirname, "index.html"), path.join(__dirname, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "ui-monospace", "monospace"] },
      colors: {
        ink: { 950: "#050607", 900: "#0a0c0e", 850: "#0e1114", 800: "#13171b", 700: "#1b2026", 600: "#262d35", 500: "#36404a" },
        neon: { cyan: "#22d3ee", emerald: "#10b981", red: "#f43f5e", amber: "#f59e0b" },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(34,211,238,.25), 0 0 18px -4px rgba(34,211,238,.35)",
        glowg: "0 0 0 1px rgba(16,185,129,.25), 0 0 18px -4px rgba(16,185,129,.35)",
      },
      keyframes: {
        pulseDot: { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.35 } },
        flashUp: { "0%": { backgroundColor: "rgba(16,185,129,.28)" }, "100%": { backgroundColor: "transparent" } },
        flashDown: { "0%": { backgroundColor: "rgba(244,63,94,.28)" }, "100%": { backgroundColor: "transparent" } },
        scan: { "0%": { transform: "translateX(-100%)" }, "100%": { transform: "translateX(400%)" } },
        fadeIn: { "0%": { opacity: 0, transform: "translateY(4px)" }, "100%": { opacity: 1, transform: "none" } },
      },
      animation: {
        pulseDot: "pulseDot 1.6s ease-in-out infinite",
        flashUp: "flashUp 1.2s ease-out",
        flashDown: "flashDown 1.2s ease-out",
        scan: "scan 2.4s linear infinite",
        fadeIn: "fadeIn .25s ease-out",
      },
    },
  },
  plugins: [],
};
