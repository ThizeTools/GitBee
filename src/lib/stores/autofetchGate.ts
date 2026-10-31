// The gate that keeps a background auto-fetch from overlapping a user's git
// action. It lives apart from autofetch.ts because autofetch imports repo.ts,
// and repo.ts (withBusy) must await this gate. Putting it in autofetch.ts
// would make a repo.ts <-> autofetch.ts import cycle.
// See docs/specs/repo-refresh.md.
import { InFlightGate } from "$lib/stores/inFlightGate";

export const autofetchGate = new InFlightGate();

/**
 * Resolves when no background fetch is in flight. runAction and withBusy await
 * it after setting `busy`, so no new fetch can start while they wait.
 */
export function waitForAutofetch(): Promise<void> {
  return autofetchGate.wait();
}
