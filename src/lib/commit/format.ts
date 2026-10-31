// Text the commit details header shows, derived from the commit message and
// timestamp. Pure, so the header components stay free of parsing.

/**
 * Body of a commit message as `commit_show` returns it (`%B`: subject, blank
 * line, body). The subject line is skipped, and so is the blank line after it.
 * Usage: commitBody("Fix x\n\nLong text\n") is "Long text".
 */
export function commitBody(message: string): string {
  const lines = message.replace(/\r\n/g, "\n").split("\n");
  let i = 1;
  while (i < lines.length && lines[i] === "") i++;
  return lines.slice(i).join("\n").trim();
}

/**
 * Local date and time as `dd/mm/yyyy @ hh:mm`. `ts` is seconds since the
 * epoch, as git reports it.
 */
export function formatCommitDate(ts: number): string {
  const d = new Date(ts * 1000);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} @ ${hh}:${mi}`;
}
