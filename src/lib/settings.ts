import { createArchiveSettingsStore } from "@brain-bbqs/ember-client";

// The header toggle's storage key (see initThemeToggle in src/main.ts). Also read before first
// paint by the script configs/vite.config.ts injects into index.html.
export const THEME_KEY = "ember-sleap.theme";

// The last dandiset opened and the OAuth tokens, as one JSON record. Also read before first paint
// (by the same script) to draw the header signed in. Client-side token storage is an accepted,
// documented trade-off for a backend-free page; see SECURITY.md.
export const STORAGE_KEY = "ember-sleap.settings.v1";

export const settingsStore = createArchiveSettingsStore(STORAGE_KEY);
