import { describe, test, expect } from "bun:test";
import { autofetchGate, waitForAutofetch } from "./autofetchGate";

// Settled by hand, so the test controls when the background fetch ends.
function manualFetch(): { promise: Promise<void>; finish: () => void } {
  let finish: () => void = () => {};
  const promise = new Promise<void>((resolve) => { finish = resolve; });
  return { promise, finish };
}

describe("waitForAutofetch", () => {
  test("resolves at once when no fetch is in flight", async () => {
    await waitForAutofetch();
    expect(autofetchGate.active).toBe(false);
  });

  test("does not resolve while a fetch runs, and resolves when it ends", async () => {
    const fetch = manualFetch();
    void autofetchGate.run(() => fetch.promise);
    let resolved = false;
    const waiting = waitForAutofetch().then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);
    fetch.finish();
    await waiting;
    expect(resolved).toBe(true);
  });
});
