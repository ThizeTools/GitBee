import { writable } from "svelte/store";

// Single-source-of-truth modal switch. Context menus and shortcuts request
// a modal by setting this store; the root layout renders the matching
// component. Keeping this app-global avoids prop-drilling modal state
// through the menu stack.
export type ModalRequest =
  | { kind: "edit-commit-message"; sha: string; current: string }
  | { kind: "set-upstream"; branch: string }
  | { kind: "worktree-create"; reference: string; refLabel: string; isRemoteBranch: boolean };

export const activeModal = writable<ModalRequest | null>(null);

export function openModal(req: ModalRequest): void { activeModal.set(req); }
export function closeModal(): void { activeModal.set(null); }
