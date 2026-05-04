import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const port = parseInt(process.env.PORT ?? "8089", 10);
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  base: basePath,
  build: {
    outDir: "dist/public",
    emptyOutDir: true,
  },
  server: {
    port,
    proxy: {
      "/api": { target: "http://localhost:8089", changeOrigin: true },
      "/socket.io": { target: "http://localhost:8089", changeOrigin: true, ws: true },
    },
  },
});
