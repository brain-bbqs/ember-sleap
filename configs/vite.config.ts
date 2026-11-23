import { defineConfig, type Plugin } from "vite";
import { createViteConfig } from "@brain-bbqs/config/vite";
import { PRE_PAINT_PLUGIN_NAME } from "@brain-bbqs/config/pre-paint";
// With the extension: Vite's native config loader (its future default) refuses extensionless
// imports between config files.
import { STORAGE_KEY } from "../src/lib/settings.ts";

/**
 * The signed-in half of @brain-bbqs/config's prePaintPlugin: a returning visitor's header shows the
 * account slot rather than the sign-in button from the first frame. The shared plugin always applies
 * a stored light/dark choice as well, which this page, dark only like the SLEAP app (index.html pins
 * data-theme="dark"), must not do. Registered under the shared name so Storybook drops it as it
 * drops the shared one.
 */
function signedInPrePaint(settingsKey: string): Plugin {
  const script = [
    "try {",
    `  var storedSettings = JSON.parse(localStorage.getItem(${JSON.stringify(settingsKey)}));`,
    "  if (storedSettings && storedSettings.oauth && storedSettings.oauth.accessToken) {",
    '    document.documentElement.dataset.signedIn = "1";',
    "  }",
    "} catch (e) {}",
  ].join("\n");
  return {
    name: PRE_PAINT_PLUGIN_NAME,
    transformIndexHtml: () => [{ tag: "script", children: script, injectTo: "head-prepend" }],
  };
}

export default defineConfig(
  createViteConfig({
    rootDir: new URL("..", import.meta.url),
    overrides: {
      plugins: [signedInPrePaint(STORAGE_KEY)],
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
