import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const API_PORT = Number(process.env.BOTS_PORT ?? 4747);

export default defineConfig({
  root: "app",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": `http://localhost:${API_PORT}`,
      "/media": `http://localhost:${API_PORT}`,
    },
  },
  build: { outDir: "../dist", emptyOutDir: true },
});
