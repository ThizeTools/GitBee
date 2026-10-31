// Commit template handling for the commit box. The backend returns the raw
// file text (`commit_template`); this file turns it into the summary and
// description fields. Spec: docs/specs/commit-box.md "Commit template".

export interface TemplateFields {
  summary: string;
  description: string;
}

/**
 * Drops `#` comment lines, as git does when it reads a template, and
 * normalizes CRLF so a template written on Windows splits the same way.
 *
 * @example stripTemplateComments("# hint\nfix: x") // "fix: x"
 */
export function stripTemplateComments(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
}

/**
 * Splits a template into the summary (first non-blank line) and the
 * description (everything after it, outer blank lines removed). A template
 * that is only comments gives two empty fields.
 *
 * @example splitTemplate("fix: x\n\nBody.\n# note") // { summary: "fix: x", description: "Body." }
 */
export function splitTemplate(text: string): TemplateFields {
  const lines = stripTemplateComments(text).split("\n");
  const first = lines.findIndex((line) => line.trim() !== "");
  if (first === -1) return { summary: "", description: "" };
  const summary = lines[first].trim();
  const rest = trimBlankLines(lines.slice(first + 1));
  return { summary, description: rest.join("\n").trimEnd() };
}

function trimBlankLines(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === "") start++;
  while (end > start && lines[end - 1].trim() === "") end--;
  return lines.slice(start, end);
}

/*
 * The first focus of the summary field in each repo reads the template once.
 * WHY once per session and not on every focus: a user who clears the box and
 * focuses again expects an empty box, not the template coming back.
 */
const templateAttempted = new Set<string>();

/**
 * True the first time it is called for `repo`, false afterwards.
 *
 * @example claimFirstTemplateRead("/a") // true, then false
 */
export function claimFirstTemplateRead(repo: string): boolean {
  if (templateAttempted.has(repo)) return false;
  templateAttempted.add(repo);
  return true;
}
