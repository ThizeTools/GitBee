// Items for the status bar identity pill's menu: one "Apply" line per profile,
// then "Manage profiles…". Pure, so the list can be tested without the DOM.
// Spec: docs/specs/git-profiles.md "Status bar pill".

import type { MenuItem } from "$lib/stores/contextmenu";
import { profileLabel, type Profile } from "./profile";

export interface PillMenuHandlers {
  apply: (profile: Profile) => void;
  manage: () => void;
}

/**
 * The pill's menu. With no profiles, a disabled line says so, and Manage still
 * opens so the user can make one.
 */
export function pillMenuItems(profiles: readonly Profile[], handlers: PillMenuHandlers): MenuItem[] {
  const manage: MenuItem = { label: "Manage profiles…", onClick: () => handlers.manage() };
  if (profiles.length === 0) {
    return [{ label: "No profiles yet", disabled: true }, { label: "", separator: true }, manage];
  }
  const applyItems = profiles.map((p): MenuItem => ({
    label: applyLabel(p),
    onClick: () => handlers.apply(p),
  }));
  return [...applyItems, { label: "", separator: true }, manage];
}

/** "Apply Work: Jane <jane@work.example>", with "(default)" on the default profile. */
function applyLabel(profile: Profile): string {
  const tag = profile.isDefault ? " (default)" : "";
  return `Apply ${profileLabel(profile)}${tag}`;
}
