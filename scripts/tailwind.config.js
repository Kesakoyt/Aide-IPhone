/**
 * Tailwind configuration for Aide iPhone.
 *
 * The generated stylesheet is committed as ../tailwind.css so the deployed app
 * has no runtime CDN dependency. Rebuild after changing markup or classes:
 *
 *   cd scripts
 *   npm run build:css
 *
 * Content paths are resolved from the repository root so the command works
 * regardless of the current working directory.
 */
const path = require("path");

const root = path.resolve(__dirname, "..").replace(/\\/g, "/");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [`${root}/*.html`, `${root}/*.js`],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          900: "#312e81",
        },
      },
      fontFamily: {
        sans: ["Inter", "SF Pro Text", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
      },
    },
  },
};
