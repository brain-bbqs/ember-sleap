// @vitest-environment jsdom
// `?test&mock_project&mock_predictions&mock_predictions_missing`: the mock project's predictions
// are listed, but opening them finds nothing there yet, as on EMBER before a worker has written
// them. The page says so and offers to try again, keeping the project that is open.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { notOnEmberYet } from "../../src/lib/emberStorage";
import { MOCK_PREDICTIONS_PATH, MOCK_PROJECT_PATH } from "../../src/lib/testInjection";
import { bootMain, el, role } from "./helpers/mainHarness";

const listedButton = () => el("predictions-list").querySelector<HTMLButtonElement>("button")!;

beforeAll(async () => {
  const realFetch = globalThis.fetch;
  const offline: typeof fetch = (input, init) =>
    String(input).startsWith("data:") ? realFetch(input, init) : Promise.reject(new TypeError("offline"));
  await bootMain({ url: "?test&mock_project&mock_predictions&mock_predictions_missing", fetch: offline });
  await vi.waitFor(() => expect(el("predictions").hidden).toBe(false), { timeout: 5000 });
});

describe("?test&mock_project&mock_predictions&mock_predictions_missing", () => {
  it("says the listed predictions are not on EMBER yet, with a button to try again", async () => {
    listedButton().click();
    await vi.waitFor(() => expect(el("predictions-status").textContent).toBe(notOnEmberYet(MOCK_PREDICTIONS_PATH)));
    expect(el("predictions-status").classList.contains("err")).toBe(true);
    expect(el("predictions-retry").hidden).toBe(false);
    expect(el("predictions-retry").getAttribute("aria-describedby")).toBe("predictions-status");
    expect(el("project-location").textContent).toBe(`Test injection · ${MOCK_PROJECT_PATH}`);
    expect(role("file-probe").textContent).toMatch(/HDF5 signature/);
  });

  it("keeps keyboard focus on the file while trying again, and offers to try once more", async () => {
    el("predictions-retry").focus();
    el("predictions-retry").click();
    expect(document.activeElement).toBe(listedButton());
    expect(el("predictions-status").textContent).toBe(`Opening ${MOCK_PREDICTIONS_PATH}…`);
    await vi.waitFor(() => expect(el("predictions-retry").hidden).toBe(false));
    expect(el("predictions-status").textContent).toBe(notOnEmberYet(MOCK_PREDICTIONS_PATH));
    expect(document.activeElement).toBe(listedButton());
  });
});
