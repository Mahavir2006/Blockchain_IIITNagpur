/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cloud: { DEFAULT: "#F0EEE9", 50: "#F8F7F4", 200: "#E4E1D9", 300: "#D3CFC4" },
        potion: { DEFAULT: "#9E2A5A", 600: "#86224C", 100: "#F4E3EA", 50: "#FAF0F4" },
        pepper: { DEFAULT: "#D9601F", 600: "#A3460F", 700: "#86390C", 100: "#FBE8DC" },
        ink: { DEFAULT: "#26201E", 70: "#57504C", 50: "#67605B" },
        ok: { DEFAULT: "#2F6B4F", 100: "#E2EFE7" },
      },
      fontFamily: {
        sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
        serif: ['"Fraunces"', "Georgia", "serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
