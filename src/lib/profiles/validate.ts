// Field checks for the profile form. These mirror the backend rules in
// src-tauri/src/commands/profiles.rs (validate_list). The backend is the one that
// decides; these exist so each field shows its own message before a save.
// Spec: docs/specs/git-profiles.md "Validation".

import type { ProfileDraft } from "./draft";
import type { Profile } from "./profile";

export type DraftField = "name" | "userName" | "userEmail";
export type DraftErrors = Partial<Record<DraftField, string>>;

/**
 * Messages for the fields that are wrong, keyed by field. `others` is every
 * other saved profile (the one being edited left out), so its own label does
 * not count as a duplicate.
 *
 * @example validateDraft(emptyDraft(), []).name // "Enter a label, for example Work."
 */
export function validateDraft(draft: ProfileDraft, others: readonly Profile[]): DraftErrors {
  const errors: DraftErrors = {};
  const name = draft.name.trim();
  const nameError = labelError(name, others);
  if (nameError) errors.name = nameError;
  if (!draft.userName.trim()) errors.userName = "Enter the name git should record.";
  const emailError = emailFieldError(draft.userEmail.trim());
  if (emailError) errors.userEmail = emailError;
  return errors;
}

/** The label message, or undefined when the label is usable. Labels ignore case. */
function labelError(name: string, others: readonly Profile[]): string | undefined {
  if (!name) return "Enter a label, for example Work.";
  const taken = others.some((p) => p.name.trim().toLowerCase() === name.toLowerCase());
  return taken ? `A profile named "${name}" already exists.` : undefined;
}

/**
 * The email message, or undefined. Text on both sides of the first "@", the
 * same split the backend makes.
 */
function emailFieldError(email: string): string | undefined {
  if (!email) return "Enter the email git should record.";
  const at = email.indexOf("@");
  const usable = at > 0 && at < email.length - 1;
  return usable ? undefined : "Use the form name@host.";
}

/** True when no field has a message. */
export function isDraftValid(errors: DraftErrors): boolean {
  return Object.keys(errors).length === 0;
}
