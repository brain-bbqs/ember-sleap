import { defineConfig } from "vite";
import { createViteConfig, prePaintPlugin } from "@brain-bbqs/config/vite";
// With the extension: Vite's native config loader (its future default) refuses extensionless
// imports between config files.
import { STORAGE_KEY, THEME_KEY } from "../src/lib/settings.ts";

export default defineConfig(
  createViteConfig({
    rootDir: new URL("..", import.meta.url),
    overrides: {
      plugins: [prePaintPlugin({ themeKey: THEME_KEY, settingsKey: STORAGE_KEY })],
      build: {
        rolldownOptions: {
          // @talmolab/sleap-io.js imports it only to rasterize frames where a browser has no
          // OffscreenCanvas, which never happens here; its own browser build would pull in jszip.
          external: ["skia-canvas"],
        },
      },
    },
  }),
);
