// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { ProjectAsset } from "../../src/lib/emberAssets";
import { renderProjects } from "../../src/ui/projectList";

const PROJECTS: ProjectAsset[] = [
  { asset_id: "a1", path: "sub-01/labels.slp", size: 2048, fileType: "slp" },
  { asset_id: "a2", path: "sub-01/train.pkg.slp", size: 5 * 1024 ** 2, fileType: "pkg.slp" },
];

describe("renderProjects", () => {
  it("lists each project as a button that opens it, with its type and size", () => {
    const list = document.createElement("ul");
    list.hidden = true;
    const onOpen = vi.fn();
    renderProjects(list, PROJECTS, onOpen);

    const items = [...list.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual([
      "sub-01/labels.slpslp · 2.0 KB",
      "sub-01/train.pkg.slppkg.slp · 5.0 MB",
    ]);
    expect(list.hidden).toBe(false);

    list.querySelector<HTMLButtonElement>('[data-path="sub-01/train.pkg.slp"]')!.click();
    expect(onOpen).toHaveBeenCalledWith(PROJECTS[1]);
  });

  it("empties and hides the list when there is nothing to open", () => {
    const list = document.createElement("ul");
    renderProjects(list, PROJECTS, vi.fn());
    renderProjects(list, [], vi.fn());
    expect(list.children.length).toBe(0);
    expect(list.hidden).toBe(true);
  });
});
