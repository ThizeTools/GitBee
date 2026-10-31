// Requests from palette items to overlays the palette mounts itself. The
// Shortcuts panel is normally opened from the status bar with that component's
// own state, so the palette needs a store to reach a second instance.

import { writable } from "svelte/store";

export const shortcutsOpen = writable<boolean>(false);
