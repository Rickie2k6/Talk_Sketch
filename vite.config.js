import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/analyze-sketch": "http://localhost:3001",
      "/recognize-math": "http://localhost:3001",
    },
  },
});
