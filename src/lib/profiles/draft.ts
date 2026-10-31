// The profile form's fields as text, and the conversion to and from a Profile.
// The form keeps every field as a string (inputs are strings); the wire shape
// leaves optional fields out instead of sending empty strings.

import type { GpgFormat, Profile } from "./profile";

export interface ProfileDraft {
  name: string;
  userName: string;
  userEmail: string;
  signingKey: string;
  /** "" means no GPG format is set. */
  gpgFormat: GpgFormat | "";
  isDefault: boolean;
}

export function emptyDraft(): ProfileDraft {
  return { name: "", userName: "", userEmail: "", signingKey: "", gpgFormat: "", isDefault: false };
}

/** The form's starting values for editing `profile`. */
export function draftFromProfile(profile: Profile): ProfileDraft {
  return {
    name: profile.name,
    userName: profile.userName,
    userEmail: profile.userEmail,
    signingKey: profile.signingKey ?? "",
    gpgFormat: profile.gpgFormat ?? "",
    isDefault: profile.isDefault === true,
  };
}

/**
 * The profile a draft describes, with `id` (a new id for a new profile, the
 * existing one when editing). Text is trimmed. An empty signing key or format
 * is left out of the result, not sent as "".
 *
 * @example profileFromDraft({ ...emptyDraft(), name: " Work " }, "p1").name // "Work"
 */
export function profileFromDraft(draft: ProfileDraft, id: string): Profile {
  const signingKey = draft.signingKey.trim();
  return {
    id,
    name: draft.name.trim(),
    userName: draft.userName.trim(),
    userEmail: draft.userEmail.trim(),
    ...(signingKey ? { signingKey } : {}),
    ...(draft.gpgFormat ? { gpgFormat: draft.gpgFormat } : {}),
    isDefault: draft.isDefault,
  };
}
