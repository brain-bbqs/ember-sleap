import type { MountSleapApp } from "../lib/sleapContract";

export interface SleapComponent {
  mountSleapApp: MountSleapApp;
  version: string;
  /** True while the stand-in is what mounts, so the page can say so. */
  standIn: boolean;
}

/**
 * The one place that decides what gets mounted, loaded on first open so the page paints first.
 * Once `@talmolab/sleap-app` (or the fork's tarball) is installed, this becomes:
 *
 *   const pkg = await import("@talmolab/sleap-app");
 *   return { mountSleapApp: pkg.mountSleapApp, version: pkg.version, standIn: false };
 */
export async function loadSleapComponent(): Promise<SleapComponent> {
  const { mountStandIn, STAND_IN_VERSION } = await import("./sleapStandIn");
  return { mountSleapApp: mountStandIn, version: STAND_IN_VERSION, standIn: true };
}
