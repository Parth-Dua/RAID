/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0b0d",
          900: "#111318",
          800: "#181b21",
          700: "#20242c",
          600: "#2a2f39",
          500: "#3a4150",
          400: "#5b6472",
          300: "#8891a0",
          200: "#b7bfc9",
          100: "#e4e7ec",
        },
        sev: {
          1: "#e5484d",
          2: "#f5a623",
          3: "#5b9bd5",
        },
        accent: {
          DEFAULT: "#4f8cff",
          soft: "#213257",
        },
        ok: "#3ecf8e",
        warn: "#f5a623",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
