/** Last path segment. Accepts `/` and `\` because git emits `/` while paths
 *  pasted from Windows tools may use `\`. */
export function basenameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(cut + 1);
}

/** Lower-cased extension without the dot, or "" when there is none. A name
 *  that starts with a dot (`.env`) has no extension. */
export function extensionOf(path: string): string {
  const base = basenameOf(path);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase();
}
