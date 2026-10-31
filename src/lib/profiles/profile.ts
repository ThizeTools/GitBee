// Git profile model and the pure helpers the status bar, the manager dialog
// and the commit box share. The wire shape matches src-tauri/src/commands/profiles.rs.
// Spec: docs/specs/git-profiles.md.

export const GPG_FORMATS = ["openpgp", "ssh", "x509"] as const;
export type GpgFormat = (typeof GPG_FORMATS)[number];

/** One named identity. Optional fields are absent (not null) when unset. */
export interface Profile {
  id: string;
  /** The label in the UI. Git never sees it. */
  name: string;
  userName: string;
  userEmail: string;
  signingKey?: string;
  gpgFormat?: GpgFormat;
  /** The profile the picker pre-selects for new repos. At most one. */
  isDefault?: boolean;
}

/** Where a repo's identity comes from: this repo's config, another file, or nowhere. */
export type IdentitySource = "local" | "global" | "none";

export interface RepoIdentity {
  /** Empty when git has no user.name for the repo. */
  name: string;
  /** Empty when git has no user.email for the repo. */
  email: string;
  source: IdentitySource;
}

/** The status bar dot's color, as a CSS class suffix. */
export type IdentityTone = "accent" | "muted" | "warn";

/**
 * "Name <email>". A missing half is left out, so a repo with only an email
 * still reads sensibly. Both missing gives an empty string.
 *
 * @example identityText("Jane", "jane@work.example") // "Jane <jane@work.example>"
 */
export function identityText(name: string, email: string): string {
  if (name && email) return `${name} <${email}>`;
  if (email) return `<${email}>`;
  return name;
}

/** The status bar pill text: the identity, or the warning when there is none. */
export function pillText(identity: RepoIdentity): string {
  if (identity.source === "none") return "No git identity";
  return identityText(identity.name, identity.email);
}

/**
 * The commit box's line above the commit button. Null while the identity is
 * unknown (not read yet, or the read failed), so nothing is shown rather than a guess.
 *
 * @example commitIdentityHint(null) // null
 */
export function commitIdentityHint(identity: RepoIdentity | null): { text: string; warn: boolean } | null {
  if (identity === null) return null;
  if (identity.source === "none") return { text: "No git identity set for this repo", warn: true };
  return { text: `Committing as ${identityText(identity.name, identity.email)}`, warn: false };
}

/**
 * The dot color for a source. Local is the accent (this repo has its own
 * identity), global is muted (it is the machine default), none is the warning.
 */
export function identityTone(source: IdentitySource): IdentityTone {
  if (source === "local") return "accent";
  if (source === "global") return "muted";
  return "warn";
}

/** The profile as the menu and the picker name it: "Work: Jane <jane@work.example>". */
export function profileLabel(profile: Profile): string {
  return `${profile.name}: ${identityText(profile.userName, profile.userEmail)}`;
}

/** The default profile, or undefined when none is marked. */
export function defaultProfile(list: readonly Profile[]): Profile | undefined {
  return list.find((p) => p.isDefault === true);
}

/**
 * The list with `profile` in place of the one that has its id, or appended when
 * the id is new. A profile marked default clears the mark on every other one,
 * so the list never holds two defaults.
 *
 * @example upsertProfile([a], { ...b, isDefault: true }) // [a without default, b default]
 */
export function upsertProfile(list: readonly Profile[], profile: Profile): Profile[] {
  const exists = list.some((p) => p.id === profile.id);
  const replaced = exists
    ? list.map((p) => (p.id === profile.id ? profile : p))
    : [...list, profile];
  if (!profile.isDefault) return replaced;
  return replaced.map((p) => (p.id === profile.id ? p : { ...p, isDefault: false }));
}

/** A new profile id. Random, so two profiles never collide across sessions. */
export function makeProfileId(): string {
  return globalThis.crypto.randomUUID();
}
