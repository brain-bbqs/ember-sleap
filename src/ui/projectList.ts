import { button, h } from "@brain-bbqs/ui";
import { humanSize } from "@brain-bbqs/utils";
import type { ProjectAsset } from "../lib/emberAssets";

/** Lists a dandiset's projects as buttons that open them; the list hides when there are none. */
export function renderProjects(list: HTMLUListElement, projects: ProjectAsset[], onOpen: (p: ProjectAsset) => void) {
  list.replaceChildren(
    ...projects.map((project) => {
      const open = button("project-open", project.path);
      open.dataset.path = project.path;
      open.addEventListener("click", () => onOpen(project));
      const item = h("li", "project-item");
      item.append(open, h("span", "hint", `${project.fileType} · ${humanSize(project.size)}`));
      return item;
    }),
  );
  list.hidden = projects.length === 0;
}
