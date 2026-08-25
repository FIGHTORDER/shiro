import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tauri expects a fixed port and no auto-open.
  server: { port: 1420, strictPort: true },
  build: { target: "chrome105", outDir: "dist", emptyOutDir: true },
});
