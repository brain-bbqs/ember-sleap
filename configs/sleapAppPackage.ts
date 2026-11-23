// Serves the @talmolab/sleap-app package (the SLEAP web app built as a component, installed from
// brain-bbqs/sleap-app's embed/package branch) beside the page at `sleap-app/`, as is: the dev
// server answers from node_modules, and a build copies the folder into dist. The page imports
// `sleap-app/sleap-app.js` at run time and mounts it with that folder as its assetBaseUrl, so the
// app's chunks, workers, stylesheet, h5wasm and video decoders all load from this page's own host,
// and Vite never re-bundles the prebuilt app.
import { cpSync, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

export const SLEAP_APP_PATH = "sleap-app";
const PACKAGE_DIR = fileURLToPath(new URL("../node_modules/@talmolab/sleap-app/", import.meta.url));

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".html": "text/html",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

export function sleapAppPackage(): Plugin {
  return {
    name: "ember-sleap:sleap-app-package",
    configureServer(server) {
      server.middlewares.use(`/${SLEAP_APP_PATH}`, (req, res, next) => {
        const path = normalize(join(PACKAGE_DIR, decodeURIComponent((req.url ?? "/").split("?")[0])));
        if (
          !path.startsWith(PACKAGE_DIR.replace(/[\\/]$/, "") + sep) ||
          !existsSync(path) ||
          !statSync(path).isFile()
        ) {
          return next();
        }
        res.setHeader("Content-Type", TYPES[extname(path)] ?? "application/octet-stream");
        res.end(readFileSync(path));
      });
    },
    writeBundle(options) {
      if (!options.dir) return;
      cpSync(PACKAGE_DIR, join(options.dir, SLEAP_APP_PATH), { recursive: true });
    },
  };
}
