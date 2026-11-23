// Loaded via Vite's `?raw` import so this story always mirrors the real markup in index.html
// instead of a hand-maintained copy that can drift out of sync.
import indexHtml from "../index.html?raw";

// Injected by configs/storybook/main.ts, the same way vite.config.ts injects it for the real app.
declare const __APP_VERSION__: string;

function buildApp(): HTMLElement {
  const doc = new DOMParser().parseFromString(indexHtml, "text/html");
  // The app's own <script type="module"> wires up real behavior; Storybook only needs the static
  // markup for a visual snapshot of each state.
  doc.body.querySelectorAll("script").forEach((s) => s.remove());
  const wrapper = document.createElement("div");
  wrapper.innerHTML = doc.body.innerHTML;
  // Mirrors the one line of main.ts that runs on load; without it the footer's version link would
  // render as an empty (invisible) anchor in the snapshots.
  const version = wrapper.querySelector("#version-indicator");
  if (version) version.textContent = `v${__APP_VERSION__}`;
  return wrapper;
}

export default {
  title: "App",
};

export const Default = {
  name: "Default",
  render: () => buildApp(),
};
