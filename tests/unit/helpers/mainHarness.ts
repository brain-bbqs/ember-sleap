// Shared harness for tests that boot the real src/main.ts against the real index.html markup.
// Each test file gets its own module registry, so importing main.ts runs its top-level wiring
// exactly once per file; boot with the URL search params the scenario needs before that first
// import (one file per boot scenario, e.g. main.smoke.test.ts and main.mock-project.test.ts).
// The import stays here, in the app's own code, so Vitest transforms it and a test file's
// `vi.mock` calls apply to what main.ts imports.
import { createMainHarness } from "@brain-bbqs/test-utils/vitest";

export const { bootMain } = createMainHarness({ importMain: () => import("../../../src/main") });
export { el } from "@brain-bbqs/test-utils/vitest";
