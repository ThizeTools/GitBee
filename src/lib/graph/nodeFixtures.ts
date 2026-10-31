// Test helper: builds a GraphNode with only the fields the graph math reads.
// Lives outside *.test.ts so every graph test shares one definition.
import type { GraphNode } from "$lib/ipc";

export function makeNode(
  sha: string,
  parents: readonly string[] = [],
  lane = 0,
  row = 0,
): GraphNode {
  return {
    sha,
    parents: [...parents],
    author_name: "Ada",
    author_email: "ada@example.test",
    timestamp: 1_700_000_000,
    subject: `subject ${sha}`,
    lane,
    row,
    parent_lanes: parents.map(() => lane),
  };
}
