import { writable } from "svelte/store";

// App-wide replacement for the blocking window.confirm / prompt / alert.
// One dialog is on screen at a time; later requests wait in FIFO order, so
// a promise resolves only after every dialog requested before it. Rendering
// lives in AppDialog.svelte. See docs/specs/app-dialogs.md for the contract.

export interface ConfirmSpec {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red styling for destructive actions; Cancel gets the initial focus. */
  danger?: boolean;
}

export interface PromptSpec {
  title: string;
  message?: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Returns an inline error for the current text, or null when it is valid. */
  validate?: (value: string) => string | null;
}

export interface ChoiceOption<T> {
  label: string;
  value: T;
  description?: string;
  danger?: boolean;
}

export interface ChoiceSpec<T> {
  title: string;
  message?: string;
  /** The first choice is the default and takes the initial focus. */
  choices: ChoiceOption<T>[];
}

export interface AlertSpec {
  title: string;
  message?: string;
}

export type DialogView =
  | { kind: "confirm"; spec: ConfirmSpec }
  | { kind: "prompt"; spec: PromptSpec }
  | { kind: "choice"; spec: ChoiceSpec<unknown> }
  | { kind: "alert"; spec: AlertSpec };

export interface DialogEntry {
  readonly view: DialogView;
  /** What the promise resolves with when the user dismisses the dialog. */
  readonly cancelValue: unknown;
  /** Resolves the caller's promise with the user's answer. */
  readonly settle: (outcome: unknown) => void;
}

/** FIFO queue with exactly one active dialog. It knows nothing about the DOM:
 * every change of the active entry is reported through `onChange`, which is
 * how the Svelte store and the tests observe it. */
export class DialogQueue {
  private active: DialogEntry | null = null;
  private readonly waiting: DialogEntry[] = [];
  private readonly onChange: (active: DialogEntry | null) => void;

  constructor(onChange: (active: DialogEntry | null) => void) {
    this.onChange = onChange;
  }

  /** The dialog on screen, or null when none is open. */
  get current(): DialogEntry | null {
    return this.active;
  }

  /** Number of dialogs waiting behind the active one. */
  get pendingCount(): number {
    return this.waiting.length;
  }

  enqueue(entry: DialogEntry): void {
    this.waiting.push(entry);
    if (this.active === null) this.showNext();
  }

  /** Settles the active dialog with `outcome`, then shows the next one. */
  answer(outcome: unknown): void {
    const done = this.active;
    if (done === null) return;
    // Advance before settling: a caller that reacts to its answer by opening
    // another dialog must find the queue already moved on.
    this.showNext();
    done.settle(outcome);
  }

  /** Dismisses the active dialog with its own cancel value. */
  cancel(): void {
    if (this.active === null) return;
    this.answer(this.active.cancelValue);
  }

  private showNext(): void {
    this.active = this.waiting.shift() ?? null;
    this.onChange(this.active);
  }
}

/** The dialog currently on screen, or null. AppDialog.svelte renders it. */
export const activeDialog = writable<DialogEntry | null>(null);

const queue = new DialogQueue((entry) => activeDialog.set(entry));

/** Called by AppDialog when the user picks an answer. */
export function answerDialog(outcome: unknown): void {
  queue.answer(outcome);
}

/** Called by AppDialog on Escape and backdrop click. */
export function cancelDialog(): void {
  queue.cancel();
}

// The one place where the untyped queue meets a typed promise. Each public
// helper below pairs its view with the cancel value its kind resolves to.
function request<T>(view: DialogView, cancelValue: T): Promise<T> {
  return new Promise<T>((resolve) => {
    queue.enqueue({
      view,
      cancelValue,
      settle: (outcome) => resolve(outcome as T),
    });
  });
}

/** Resolves true on confirm, false on cancel or Escape. */
export function confirmDialog(opts: ConfirmSpec): Promise<boolean> {
  return request<boolean>({ kind: "confirm", spec: opts }, false);
}

/** Resolves with the exact text typed (untrimmed), or null on cancel. */
export function promptDialog(opts: PromptSpec): Promise<string | null> {
  return request<string | null>({ kind: "prompt", spec: opts }, null);
}

/** Resolves with the chosen value, or null on cancel. */
export function choiceDialog<T>(opts: ChoiceSpec<T>): Promise<T | null> {
  return request<T | null>({ kind: "choice", spec: opts }, null);
}

/** Resolves once the user dismisses the message. */
export function alertDialog(opts: AlertSpec): Promise<void> {
  return request<void>({ kind: "alert", spec: opts }, undefined);
}

/** Inline error for the prompt's current text, or null when it may be
 * submitted. Example: promptError({ title: "x", validate: requireName }, " ")
 * returns "Enter a name". */
export function promptError(spec: PromptSpec, value: string): string | null {
  return spec.validate?.(value) ?? null;
}

/** Validator for name prompts (branch, tag). Blank input is blocked; the
 * text itself is not trimmed, so callers keep passing exactly what was typed.
 * Example: requireName("feature/x") === null */
export function requireName(value: string): string | null {
  return value.trim() === "" ? "Enter a name" : null;
}

/** Button labels per dialog kind. A null label hides that button: alerts
 * have only OK, choice lists only Cancel (their buttons are the answers).
 * Example: footerLabels({ kind: "alert", spec: { title: "x" } }).cancel === null */
export function footerLabels(view: DialogView): { cancel: string | null; confirm: string | null } {
  switch (view.kind) {
    case "confirm":
      return { cancel: view.spec.cancelLabel ?? "Cancel", confirm: view.spec.confirmLabel ?? "OK" };
    case "prompt":
      return { cancel: "Cancel", confirm: view.spec.confirmLabel ?? "OK" };
    case "choice":
      return { cancel: "Cancel", confirm: null };
    case "alert":
      return { cancel: null, confirm: "OK" };
  }
}
