// Loaded before every unit-test file (configs/vitest.config.ts): jsdom cannot run the real SLEAP
// app, so a boot of main.ts mounts the stand-in, which drives the same host callbacks. The real
// app is covered by tests/integration/sleap-app.spec.ts, in a browser.
import { vi } from "vitest";

vi.mock("../../../src/ui/sleapComponent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/ui/sleapComponent")>();
  return {
    ...actual,
    loadSleapComponent: (options: Parameters<typeof actual.loadSleapComponent>[0] = {}) =>
      actual.loadSleapComponent({ ...options, standIn: true }),
  };
});
