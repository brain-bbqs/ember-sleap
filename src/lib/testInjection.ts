// Live smoketest URL params (`?test&...`), the scheme every BBQS companion app shares (see
// docs/README.md): a link pasted into the deployed app's address bar drives the UI into a specific,
// real state with no archive, no sign-in and no network call, so a person can eyeball each state
// live and the Playwright and Chromatic specs can reach it without heavy `page.route` stubbing.
//
// This module only *parses* the query string and builds the fakes; each is inert until main.ts
// substitutes it at the one point the real code path would otherwise reach EMBER, Hugging Face or
// the compute proxy, so a state built this way runs through the same rendering code a real one
// would. `?test` alone is a no-op. Nothing here writes to localStorage.
import { toHostRef } from "./hostRef";
import type { ModelSource } from "./modelCatalogue";
import type { ModelCard, OpenRequest } from "./sleapContract";

export interface TestInjection {
  /** Opens a synthesized project into the embedded app, with in-memory saves, two fixed models
   * and the in-browser compute stub, so every state of the embed can be reached offline. */
  mockProject: boolean;
}

export function readTestInjection(search: string): TestInjection | null {
  const params = new URLSearchParams(search);
  if (!params.has("test")) return null;
  return { mockProject: params.has("mock_project") };
}

/** Not a dandiset id the archive can issue, so a mock location is never mistaken for a real one. */
export const MOCK_DANDISET_ID = "mock";
export const MOCK_PROJECT_PATH = "sub-mock/test-injection-mock-project.slp";
const MOCK_PROJECT_BYTES = 2048;
const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The project `?test&mock_project` opens: a fixed-size file that starts with the HDF5 signature a
 * real `.slp` has, served from a `data:` URL so reading it needs no network. Like an archive URL,
 * it says nothing about the file's type; that travels beside it.
 */
export function mockProjectRequest(): OpenRequest {
  const bytes = new Uint8Array(MOCK_PROJECT_BYTES);
  bytes.set(HDF5_SIGNATURE);
  return {
    url: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`,
    fileType: "slp",
    name: "test-injection-mock-project.slp",
    ref: toHostRef({ dandisetId: MOCK_DANDISET_ID, path: MOCK_PROJECT_PATH }),
  };
}

export const MOCK_MODELS: readonly ModelCard[] = [
  {
    id: "mock:single-instance",
    name: "Test injection model (single instance)",
    license: "CC-BY-4.0",
    species: "mouse",
    heads: ["single_instance"],
    skeleton: { nodes: ["head", "tail"], edges: [["head", "tail"]] },
    files: [{ role: "config", url: "data:,mock-config" }],
  },
  {
    id: "mock:top-down",
    name: "Test injection model (top-down)",
    heads: ["centroid", "centered_instance"],
    files: [{ role: "config", url: "data:,mock-config" }],
  },
];

export const mockModelSource: ModelSource = {
  name: "test injection",
  list: () => Promise.resolve([...MOCK_MODELS]),
};
