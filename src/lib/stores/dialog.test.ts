import { describe, test, expect, afterEach } from "bun:test";
import { get } from "svelte/store";
import {
  DialogQueue,
  activeDialog,
  alertDialog,
  answerDialog,
  cancelDialog,
  choiceDialog,
  confirmDialog,
  footerLabels,
  promptDialog,
  promptError,
  requireName,
  type DialogEntry,
  type DialogView,
} from "./dialog";

const ALERT_VIEW: DialogView = { kind: "alert", spec: { title: "Note" } };

/** A queue entry that records every outcome it was settled with. */
function recordingEntry(title: string, cancelValue: unknown): {
  entry: DialogEntry;
  outcomes: unknown[];
} {
  const outcomes: unknown[] = [];
  const entry: DialogEntry = {
    view: { kind: "alert", spec: { title } },
    cancelValue,
    settle: (outcome) => outcomes.push(outcome),
  };
  return { entry, outcomes };
}

function titleOf(entry: DialogEntry | null): string | null {
  return entry === null ? null : entry.view.spec.title;
}

// The store helpers share one module-level queue, so every test that opens
// a dialog must close it again before the next test starts.
afterEach(() => {
  while (get(activeDialog) !== null) cancelDialog();
});

describe("DialogQueue", () => {
  test("starts with no dialog on screen", () => {
    const queue = new DialogQueue(() => {});
    expect(queue.current).toBeNull();
    expect(queue.pendingCount).toBe(0);
  });

  test("the first enqueued dialog becomes current and the second waits", () => {
    const queue = new DialogQueue(() => {});
    queue.enqueue(recordingEntry("first", null).entry);
    queue.enqueue(recordingEntry("second", null).entry);
    expect(titleOf(queue.current)).toBe("first");
    expect(queue.pendingCount).toBe(1);
  });

  test("answering the first makes the second current", () => {
    const queue = new DialogQueue(() => {});
    const first = recordingEntry("first", null);
    queue.enqueue(first.entry);
    queue.enqueue(recordingEntry("second", null).entry);
    queue.answer(true);
    expect(first.outcomes).toEqual([true]);
    expect(titleOf(queue.current)).toBe("second");
    expect(queue.pendingCount).toBe(0);
  });

  test("dialogs are shown in FIFO order", () => {
    const queue = new DialogQueue(() => {});
    for (const title of ["a", "b", "c"]) queue.enqueue(recordingEntry(title, null).entry);
    const shown: (string | null)[] = [];
    for (let i = 0; i < 3; i++) {
      shown.push(titleOf(queue.current));
      queue.answer(undefined);
    }
    expect(shown).toEqual(["a", "b", "c"]);
    expect(queue.current).toBeNull();
  });

  test("onChange reports every change of the active dialog", () => {
    const seen: (string | null)[] = [];
    const queue = new DialogQueue((entry) => seen.push(titleOf(entry)));
    queue.enqueue(recordingEntry("first", null).entry);
    queue.enqueue(recordingEntry("second", null).entry);
    queue.answer(null);
    queue.answer(null);
    expect(seen).toEqual(["first", "second", null]);
  });

  test("cancel settles with the active dialog's own cancel value", () => {
    const queue = new DialogQueue(() => {});
    const confirm = recordingEntry("confirm", false);
    queue.enqueue(confirm.entry);
    queue.cancel();
    expect(confirm.outcomes).toEqual([false]);
  });

  test("answer and cancel with nothing open do nothing", () => {
    const queue = new DialogQueue(() => {});
    queue.answer(true);
    queue.cancel();
    expect(queue.current).toBeNull();
  });
});

describe("store helpers", () => {
  test("confirmDialog resolves true when answered with true", async () => {
    const pending = confirmDialog({ title: "Delete?" });
    answerDialog(true);
    expect(await pending).toBe(true);
  });

  test("confirmDialog resolves false on cancel", async () => {
    const pending = confirmDialog({ title: "Delete?" });
    cancelDialog();
    expect(await pending).toBe(false);
  });

  test("promptDialog resolves null on cancel", async () => {
    const pending = promptDialog({ title: "Name" });
    cancelDialog();
    expect(await pending).toBeNull();
  });

  test("promptDialog resolves with the exact text answered", async () => {
    const pending = promptDialog({ title: "Name", initial: "x" });
    answerDialog("  padded  ");
    expect(await pending).toBe("  padded  ");
  });

  test("choiceDialog resolves null on cancel", async () => {
    const pending = choiceDialog<"soft" | "hard">({
      title: "Mode",
      choices: [{ label: "Soft", value: "soft" }, { label: "Hard", value: "hard", danger: true }],
    });
    cancelDialog();
    expect(await pending).toBeNull();
  });

  test("choiceDialog resolves with the chosen value", async () => {
    const pending = choiceDialog<number>({
      title: "Pick",
      choices: [{ label: "One", value: 1 }, { label: "Two", value: 2 }],
    });
    answerDialog(2);
    expect(await pending).toBe(2);
  });

  test("alertDialog resolves undefined once dismissed", async () => {
    const pending = alertDialog({ title: "Done" });
    cancelDialog();
    expect(await pending).toBeUndefined();
  });

  test("a second helper call waits until the first is answered", async () => {
    const first = confirmDialog({ title: "First" });
    const second = promptDialog({ title: "Second" });
    expect(get(activeDialog)?.view.spec.title).toBe("First");
    answerDialog(true);
    expect(await first).toBe(true);
    expect(get(activeDialog)?.view.kind).toBe("prompt");
    answerDialog("typed");
    expect(await second).toBe("typed");
    expect(get(activeDialog)).toBeNull();
  });
});

describe("promptError and requireName", () => {
  test("requireName blocks blank and whitespace-only text", () => {
    expect(requireName("")).toBe("Enter a name");
    expect(requireName("   ")).toBe("Enter a name");
  });

  test("requireName accepts any text with a visible character", () => {
    expect(requireName("feature/x")).toBeNull();
    expect(requireName(" a ")).toBeNull();
  });

  test("promptError is null when the spec has no validator", () => {
    expect(promptError({ title: "Free text" }, "")).toBeNull();
  });

  test("promptError passes the typed value to the validator", () => {
    const spec = { title: "Name", validate: requireName };
    expect(promptError(spec, "  ")).toBe("Enter a name");
    expect(promptError(spec, "ok")).toBeNull();
  });
});

describe("footerLabels", () => {
  test("confirm defaults to Cancel and OK", () => {
    expect(footerLabels({ kind: "confirm", spec: { title: "x" } })).toEqual({
      cancel: "Cancel",
      confirm: "OK",
    });
  });

  test("confirm uses the given labels", () => {
    const view: DialogView = {
      kind: "confirm",
      spec: { title: "x", confirmLabel: "Delete", cancelLabel: "Keep" },
    };
    expect(footerLabels(view)).toEqual({ cancel: "Keep", confirm: "Delete" });
  });

  test("prompt has Cancel and a confirm button", () => {
    expect(footerLabels({ kind: "prompt", spec: { title: "x", confirmLabel: "Save" } })).toEqual({
      cancel: "Cancel",
      confirm: "Save",
    });
  });

  test("choice has only Cancel, since its buttons are the answers", () => {
    expect(footerLabels({ kind: "choice", spec: { title: "x", choices: [] } })).toEqual({
      cancel: "Cancel",
      confirm: null,
    });
  });

  test("alert has only OK", () => {
    expect(footerLabels(ALERT_VIEW)).toEqual({ cancel: null, confirm: "OK" });
  });
});
