import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendPortFile = path.resolve(__dirname, "../backend/.backend-port");

function getBackendTarget() {
  if (process.env.VITE_BACKEND_URL) {
    return process.env.VITE_BACKEND_URL;
  }

  if (fs.existsSync(backendPortFile)) {
    const backendPort = fs.readFileSync(backendPortFile, "utf8").trim();
    if (/^\d+$/.test(backendPort)) {
      return `http://127.0.0.1:${backendPort}`;
    }
  }

  return "http://127.0.0.1:8080";
}

const backendTarget = getBackendTarget();

export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@excalidraw/excalidraw/index.css": path.resolve(
        __dirname,
        "node_modules/@excalidraw/excalidraw/dist/prod/index.css",
      ),
    },
  },

  define: {
    "process.env": {},
    process: { env: {} },
  },

  server: {
    host: process.env.VITE_HOST || "0.0.0.0",
    port: process.env.VITE_PORT ? Number(process.env.VITE_PORT) : undefined,
    strictPort: false,
    proxy: {
      "/analyze-sketch": backendTarget,
      "/recognize-math": backendTarget,
      "/history": backendTarget,
      "/events": backendTarget,
      "/users/active": backendTarget,
      "/socket.io": {
        target: backendTarget,
        ws: true,
      },
    },
    middlewareMode: false,
  },

  build: {
    minify: "terser",
    sourcemap: false,
  },

  optimizeDeps: {
    include: ["react", "react-dom", "@excalidraw/excalidraw"],
  },
});
