// Tracks the one background git operation that must not overlap a user's git
// action. Kept free of Svelte and Tauri imports so it is unit tested as-is.

export class InFlightGate {
  private current: Promise<void> | null = null;

  get active(): boolean {
    return this.current !== null;
  }

  /** Starts `work` and remembers it until it settles. Callers check `active` first. */
  run(work: () => Promise<void>): Promise<void> {
    const pending = work().finally(() => {
      if (this.current === pending) this.current = null;
    });
    this.current = pending;
    return pending;
  }

  /** Resolves when nothing is in flight, or when the current run settles. */
  wait(): Promise<void> {
    return this.current ?? Promise.resolve();
  }
}
