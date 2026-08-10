import { defineConfig } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

interface TrackerEventConfiguration {
  slug: string;
}

const trackerEvents = JSON.parse(
  readFileSync(new URL("./tracker/events.json", import.meta.url), "utf8"),
) as TrackerEventConfiguration[];
const trackerInputs = Object.fromEntries(
  trackerEvents.map((event) => [
    `tracker${event.slug}`,
    resolve(import.meta.dirname, `tracker/${event.slug}/index.html`),
  ]),
);

export default defineConfig({
  base: "./",
  build: {
    outDir: "../../dist/site",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        landing: resolve(import.meta.dirname, "index.html"),
        explorer: resolve(import.meta.dirname, "browse/index.html"),
        spacefarer: resolve(
          import.meta.dirname,
          "spacefarer/index.html",
        ),
        ...trackerInputs,
      },
    },
  },
  server: {
    fs: {
      allow: ["../.."],
    },
  },
});
