/** Minimal Vite config for Bazel (sandbox) build. Single dummy entry only. */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    rollupOptions: {
      input: "./index_bazel.html",
    },
    outDir: "dist",
  },
});
