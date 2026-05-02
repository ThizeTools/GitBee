import { writable } from "svelte/store";

// True when the Info / Features page is taking the place of the main view.
export const showingInfo = writable<boolean>(false);
