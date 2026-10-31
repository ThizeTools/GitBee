// Co-authored-by trailers in a commit description. The description text is the
// single source of truth: the chips in the commit box are parsed from it, and
// adding or removing a chip edits its line. Spec: docs/specs/commit-box.md
// "Co-authors". Git reads these as trailers when the message is committed.

export interface CoAuthor {
  name: string;
  email: string;
}

const TRAILER_LINE = /^Co-authored-by:\s*(.*?)\s*<([^<>\s]+)>\s*$/i;

/**
 * The trailer line for one person. A missing name falls back to the email,
 * because `Co-authored-by: <email>` is not a valid trailer.
 *
 * @example coAuthorLine({ name: "Ana", email: "a@x.io" }) // "Co-authored-by: Ana <a@x.io>"
 */
export function coAuthorLine(person: CoAuthor): string {
  const name = person.name.trim() || person.email;
  return `Co-authored-by: ${name} <${person.email}>`;
}

/**
 * Every Co-authored-by line in the description, in order. Emails are compared
 * case-insensitively elsewhere, so they are returned as written.
 *
 * @example parseCoAuthors("Body\n\nCo-authored-by: Ana <a@x.io>") // [{ name: "Ana", email: "a@x.io" }]
 */
export function parseCoAuthors(description: string): CoAuthor[] {
  const people: CoAuthor[] = [];
  for (const line of normalize(description).split("\n")) {
    const match = TRAILER_LINE.exec(line);
    if (match) people.push({ name: match[1], email: match[2] });
  }
  return people;
}

/**
 * Appends the person's trailer at the end of the description. A blank line
 * separates a body from a new trailer block; a trailer added to an existing
 * block goes directly under it. An email already present is not added again.
 *
 * @example addCoAuthor("Fix it.", { name: "Ana", email: "a@x.io" }) // "Fix it.\n\nCo-authored-by: Ana <a@x.io>"
 */
export function addCoAuthor(description: string, person: CoAuthor): string {
  if (hasEmail(parseCoAuthors(description), person.email)) return description;
  const body = normalize(description).replace(/\s+$/, "");
  const line = coAuthorLine(person);
  if (body === "") return line;
  const lastLine = body.split("\n").pop() ?? "";
  const separator = TRAILER_LINE.test(lastLine) ? "\n" : "\n\n";
  return `${body}${separator}${line}`;
}

/**
 * Removes every trailer line for `email`, then trims the blank lines the
 * removal may leave at the end.
 *
 * @example removeCoAuthor("Fix.\n\nCo-authored-by: Ana <a@x.io>", "a@x.io") // "Fix."
 */
export function removeCoAuthor(description: string, email: string): string {
  const wanted = email.toLowerCase();
  const kept = normalize(description)
    .split("\n")
    .filter((line) => !isTrailerFor(line, wanted));
  return kept.join("\n").replace(/\s+$/, "");
}

function isTrailerFor(line: string, lowerEmail: string): boolean {
  const match = TRAILER_LINE.exec(line);
  return match !== null && match[2].toLowerCase() === lowerEmail;
}

function hasEmail(people: CoAuthor[], email: string): boolean {
  const wanted = email.toLowerCase();
  return people.some((p) => p.email.toLowerCase() === wanted);
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}
