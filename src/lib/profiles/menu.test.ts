import { describe, expect, test } from "bun:test";
import { pillMenuItems, type PillMenuHandlers } from "./menu";
import type { Profile } from "./profile";

const WORK: Profile = { id: "p1", name: "Work", userName: "Jane Doe", userEmail: "jane@work.example" };
const HOME: Profile = { id: "p2", name: "Home", userName: "Jane", userEmail: "jane@home.example", isDefault: true };

/** Handlers that record what the menu asked for. */
class RecordingHandlers implements PillMenuHandlers {
  readonly applied: Profile[] = [];
  managed = 0;

  apply(profile: Profile): void {
    this.applied.push(profile);
  }

  manage(): void {
    this.managed += 1;
  }
}

describe("pillMenuItems", () => {
  test("with no profiles, a disabled line says so and Manage still opens", () => {
    const handlers = new RecordingHandlers();
    const items = pillMenuItems([], handlers);
    expect(items[0]).toMatchObject({ label: "No profiles yet", disabled: true });
    expect(items[1].separator).toBe(true);
    items[2].onClick?.();
    expect(handlers.managed).toBe(1);
  });

  test("one Apply line per profile, in list order, with the default marked", () => {
    const labels = pillMenuItems([WORK, HOME], new RecordingHandlers()).map((i) => i.label);
    expect(labels).toEqual([
      "Apply Work: Jane Doe <jane@work.example>",
      "Apply Home: Jane <jane@home.example> (default)",
      "",
      "Manage profiles…",
    ]);
  });

  test("each Apply line applies its own profile", () => {
    const handlers = new RecordingHandlers();
    pillMenuItems([WORK, HOME], handlers)[1].onClick?.();
    expect(handlers.applied).toEqual([HOME]);
  });
});
