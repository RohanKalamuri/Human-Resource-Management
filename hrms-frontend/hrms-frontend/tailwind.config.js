/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Space Grotesk"', "sans-serif"],
        sans: ['"Inter"', "sans-serif"],
        mono: ['"IBM Plex Mono"', "monospace"],
      },
      colors: {
        ink: {
          DEFAULT: "#161B22",
          700: "#212836",
          600: "#2B3344",
          500: "#3A4356",
          400: "#5B6478",
          300: "#8892A6",
        },
        paper: {
          DEFAULT: "#F1F3F7",
          dim: "#E7EAF1",
        },
        brand: {
          50: "#EAF3F2",
          100: "#CFE6E3",
          200: "#A3CFC9",
          400: "#2E7D77",
          500: "#0F5257",
          600: "#0C4145",
          700: "#0A3437",
          900: "#062123",
        },
        accent: {
          50: "#FDF3E3",
          100: "#FBE3B8",
          300: "#F3C077",
          400: "#EFAE4C",
          500: "#E8A33D",
          600: "#C97F1F",
          700: "#9C6216",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgba(22,27,34,0.04), 0 8px 24px -12px rgba(22,27,34,0.10)",
        pop: "0 12px 32px -8px rgba(22,27,34,0.28)",
      },
      keyframes: {
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 rgba(232,163,61,0.45)" },
          "70%": { boxShadow: "0 0 0 14px rgba(232,163,61,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(232,163,61,0)" },
        },
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        pulseRing: "pulseRing 2.2s cubic-bezier(0.4,0,0.6,1) infinite",
        fadeUp: "fadeUp 0.35s ease-out both",
      },
    },
  },
  plugins: [],
};
