// The slice of the IPC client the profile stores call. Stores take it as a
// parameter so tests can pass a fake (see identityStore.test.ts).

import type { ipc } from "$lib/ipc";

export type ProfilesApi = Pick<typeof ipc, "profilesList" | "profilesSave" | "profileApply" | "repoIdentity">;
