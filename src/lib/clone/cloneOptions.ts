// Pure turn of the clone dialog's fields into the options `repo_clone` takes.
// The dialog shows `error` next to the form and disables Clone while it is set.
// The backend checks the same rules again (repo_extra.rs), so a bad value
// never reaches git even from another caller. See docs/specs/clone-options.md.

/** Options sent to `repo_clone`. `null` depth or branch means git's default. */
export interface CloneOptions {
  depth: number | null;
  branch: string | null;
  singleBranch: boolean;
}

/** What the dialog's fields hold, as the user left them. */
export interface CloneForm {
  shallow: boolean;
  depthText: string;
  singleBranch: boolean;
  branchText: string;
}

/** `options` are sent only when `error` is null. */
export interface CloneCheck {
  options: CloneOptions;
  error: string | null;
}

/** Depth the dialog shows before the user types one. */
export const DEFAULT_CLONE_DEPTH = 1;

/** The depth as a whole number of at least 1, or null when the text is not one. */
export function parseDepth(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const depth = Number(trimmed);
  return depth >= 1 ? depth : null;
}

/** Checks the form and builds the clone options. A value git would read as an option is refused here. */
export function checkCloneForm(form: CloneForm): CloneCheck {
  const branch = form.singleBranch ? form.branchText.trim() : "";
  const depth = form.shallow ? parseDepth(form.depthText) : null;
  const options: CloneOptions = {
    depth,
    branch: branch === "" ? null : branch,
    singleBranch: form.singleBranch,
  };
  return { options, error: formError(form, depth, branch) };
}

// Early returns: the first problem wins, and the message names the bad value.
function formError(form: CloneForm, depth: number | null, branch: string): string | null {
  if (form.shallow && depth === null) {
    return `Depth must be a whole number of at least 1, got "${form.depthText}".`;
  }
  if (branch.startsWith("-")) {
    return `Branch name must not start with "-", got "${branch}".`;
  }
  return null;
}
