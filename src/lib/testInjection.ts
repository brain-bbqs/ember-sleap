// Live smoketest URL params (`?test&...`), the scheme every BBQS companion app shares (see
// docs/README.md): a link pasted into the deployed app's address bar drives the UI into a specific,
// real state with no archive, no sign-in and no network call, so a person can eyeball each state
// live and the Playwright and Chromatic specs can reach it without heavy `page.route` stubbing.
//
// This module only *parses* the query string and builds the fakes; each is inert until main.ts
// substitutes it at the one point the real code path would otherwise reach EMBER, so a state built
// this way runs through the same rendering code a real one would. `?test` alone is a no-op.
// Nothing here writes to localStorage.
import { toHostRef } from "./hostRef";
import type { NewProjectRequest, OpenRequest } from "./sleapContract";

export interface TestInjection {
  /** Opens a synthesized project into the embedded app, with in-memory saves, so every state of
   * the embed can be reached offline. */
  mockProject: boolean;
  /** Starts a new project on two synthesized videos, as choosing a dandiset with no SLEAP project
   * does, with the same in-memory saves as `mockProject`. */
  mockNewProject: boolean;
  /** The SLEAP stand-in in place of the real app, against the real archive, so the host's own
   * behavior can be driven through the stand-in's controls. Implied by either mock. */
  standIn: boolean;
}

export function readTestInjection(search: string): TestInjection | null {
  const params = new URLSearchParams(search);
  if (!params.has("test")) return null;
  return {
    mockProject: params.has("mock_project"),
    mockNewProject: params.has("mock_new_project"),
    standIn: params.has("stand_in") || params.has("mock_project") || params.has("mock_new_project"),
  };
}

/** Not a dandiset id the archive can issue, so a mock location is never mistaken for a real one. */
export const MOCK_DANDISET_ID = "mock";
export const MOCK_PROJECT_PATH = "sub-mock/test-injection-mock-project.slp";
const MOCK_PROJECT_BYTES = 2048;
const HDF5_SIGNATURE = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * A fixed-size file that starts with the HDF5 signature a real `.slp` has, served from a `data:`
 * URL so reading it needs no network. Like an archive URL, it says nothing about the file's type;
 * that travels beside it.
 */
export function mockProjectUrl(): string {
  const bytes = new Uint8Array(MOCK_PROJECT_BYTES);
  bytes.set(HDF5_SIGNATURE);
  return `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}`;
}

/** The project `?test&mock_project` opens. */
export function mockProjectRequest(): OpenRequest {
  return {
    url: mockProjectUrl(),
    fileType: "slp",
    name: "test-injection-mock-project.slp",
    ref: toHostRef({ dandisetId: MOCK_DANDISET_ID, path: MOCK_PROJECT_PATH }),
  };
}

/** Where the new project `?test&mock_new_project` starts has its videos, by the paths it records. */
export const MOCK_VIDEO_PATHS = [
  "sub-mock/beh/sub-mock_test-injection-mock-video-1.mp4",
  "sub-mock/beh/sub-mock_test-injection-mock-video-2.mp4",
] as const;

/**
 * The new project `?test&mock_new_project` starts. Its videos are empty `data:` URLs that no player
 * can show, so the canvas looks the same on every run; nothing fetches them.
 */
export function mockNewProjectRequest(): NewProjectRequest {
  return {
    name: "Untitled.slp",
    videos: MOCK_VIDEO_PATHS.map((path) => ({
      url: `data:video/mp4;base64,#${encodeURIComponent(path)}`,
      fileType: "mp4" as const,
      name: path.slice(path.lastIndexOf("/") + 1),
      storedPath: path,
    })),
    ref: toHostRef({ dandisetId: MOCK_DANDISET_ID, path: MOCK_VIDEO_PATHS[0] }),
  };
}
