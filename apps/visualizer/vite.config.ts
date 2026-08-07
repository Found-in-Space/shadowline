import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  build: {
    outDir: "../../dist/site",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        explorer: resolve(import.meta.dirname, "index.html"),
        spacefarer: resolve(
          import.meta.dirname,
          "spacefarer/index.html",
        ),
        tracker202608: resolve(
          import.meta.dirname,
          "tracker/202608/index.html",
        ),
      },
    },
  },
  server: {
    fs: {
      allow: ["../.."],
    },
  },
});
