import type { MountSleapApp } from "../lib/sleapContract";

export interface SleapComponent {
  mountSleapApp: MountSleapApp;
  version: string;
  /** True while the stand-in is what mounts, so the page can say so. */
  standIn: boolean;
}

/**
 * Where the page serves the SLEAP app package (@talmolab/sleap-app, built from
 * brain-bbqs/sleap-app's embed branch; configs/sleapAppPackage.ts puts it there). It is also the
 * app's assetBaseUrl: its chunks, workers, stylesheet, h5wasm and decoders load from it.
 */
export function sleapAppBaseUrl(): string {
  return new URL("sleap-app/", document.baseURI).href;
}

export interface LoadOptions {
  /**
   * The stand-in (src/ui/sleapStandIn.ts) in place of the real app: for the `?test` mocks, whose
   * synthesized files and data-roles it is built around, and for unit tests, which run in jsdom.
   */
  standIn?: boolean;
  /** Overridable for tests: imports the package's entry module by its URL. */
  importPackage?: (url: string) => Promise<unknown>;
}

interface SleapAppPackage {
  mountSleapApp: MountSleapApp;
  version: string;
}

/**
 * The one place that decides what gets mounted. The real app is imported at run time from where
 * the page serves it, so Vite never re-bundles the prebuilt package; the stand-in is bundled and
 * loaded on demand.
 */
export async function loadSleapComponent({
  standIn = false,
  importPackage = (url) => import(/* @vite-ignore */ url),
}: LoadOptions = {}): Promise<SleapComponent> {
  if (standIn) {
    const { mountStandIn, STAND_IN_VERSION } = await import("./sleapStandIn");
    return { mountSleapApp: mountStandIn, version: STAND_IN_VERSION, standIn: true };
  }
  const pkg = (await importPackage(new URL("sleap-app.js", sleapAppBaseUrl()).href)) as SleapAppPackage;
  return { mountSleapApp: pkg.mountSleapApp, version: pkg.version, standIn: false };
}
