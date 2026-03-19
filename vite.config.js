import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: process.env.VITE_HOST || "127.0.0.1",
    port: Number(process.env.VITE_PORT || 5174),
    strictPort: process.env.VITE_STRICT_PORT !== "false",
    proxy: {
      "/analyze-sketch": process.env.VITE_BACKEND_URL || "http://127.0.0.1:3001",
      "/recognize-math": process.env.VITE_BACKEND_URL || "http://127.0.0.1:3001",
    },
  },
});
