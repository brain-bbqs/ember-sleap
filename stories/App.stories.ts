// Loaded via Vite's `?raw` import so this story always mirrors the real markup in index.html
// instead of a hand-maintained copy that can drift out of sync.
import indexHtml from "../index.html?raw";

// Injected by configs/storybook/main.ts, the same way vite.config.ts injects it for the real app.
declare const __APP_VERSION__: string;

interface AppStoryOptions {
  listed?: boolean;
}

// Mirrors what main.ts renders once a dandiset's projects are listed (see listDandiset and
// renderProjects there). Storybook runs none of the app's script, so the story fills in the same
// elements by hand.
function applyListed(wrapper: HTMLElement): void {
  const input = wrapper.querySelector<HTMLInputElement>("#dandiset-input");
  if (input) input.value = "000398";
  const status = wrapper.querySelector("#open-status");
  if (status) status.textContent = "SLEAP Training Data Example (000398): 2 projects.";
  const list = wrapper.querySelector<HTMLUListElement>("#project-list");
  if (!list) return;
  for (const [path, meta] of [
    ["sub-NONE/sub-NONE_sourcedata.slp", "slp · 2.8 MB"],
    ["sub-NONE/train.pkg.slp", "pkg.slp · 619.3 MB"],
  ]) {
    const item = document.createElement("li");
    item.className = "project-item";
    const open = document.createElement("button");
    open.type = "button";
    open.className = "project-open";
    open.textContent = path;
    const hint = document.createElement("span");
    hint.className = "hint";
    hint.textContent = meta;
    item.append(open, hint);
    list.append(item);
  }
  list.hidden = false;
}

function buildApp({ listed = false }: AppStoryOptions = {}): HTMLElement {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  // The app's own <script type="module"> wires up real behavior; Storybook only needs the static
  // markup for a visual snapshot of each state.
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  const wrapper = document.createElement("div");
  wrapper.innerHTML = doc.body.innerHTML;
  // Mirrors the one line of main.ts that runs before anything is loaded; without it the footer's
  // version link would render as an empty (invisible) anchor in the snapshots.
  const version = wrapper.querySelector("#version-indicator");
  if (version) version.textContent = `v${__APP_VERSION__}`;
  if (listed) applyListed(wrapper);
  return wrapper;
}

export default {
  title: "App",
};

export const Default = {
  name: "Default (nothing listed)",
  render: () => buildApp(),
};

export const Listed = {
  name: "Projects listed",
  render: () => buildApp({ listed: true }),
};
