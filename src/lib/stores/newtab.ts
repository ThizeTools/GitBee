import { writable } from "svelte/store";

// Whether the "+" button is showing the New Tab page in place of any real tab.
// This is NOT a real tab in the tabs list (#9).
export const showingNewTab = writable<boolean>(false);
