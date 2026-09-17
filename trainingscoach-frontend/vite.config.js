import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // In dev the frontend runs on :5173 and the API on :3001. Proxying /api
    // keeps requests same-origin, so there's no CORS setup needed locally.
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  // Tests draaien in jsdom: de interface moet controleerbaar zijn zonder een
  // echte browser en zonder draaiende server, anders test niemand hem.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.js",
    // De gegenereerde rekenkern wordt aan de serverkant al uitgebreid getest;
    // hier gaat het om de interface eromheen.
    exclude: ["node_modules/**", "../trainingscoach-server/**"],
  },
  build: {
    // Build straight into the server's public/ folder so `npm start` on the
    // Pi serves the UI and the API from one process on one port.
    outDir: "../trainingscoach-server/public",
    emptyOutDir: true,
  },
});
