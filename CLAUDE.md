## Spec-driven

- Every feature starts with a spec in `docs/specs/<feature>.md`.
  No spec, no PR.
- Spec defines: purpose, public contract (inputs, outputs, errors),
  invariants, out-of-scope, and rejected alternatives with reasons.
- Keep specs short and focused (target: 200-400 lines). One spec per
  feature/module, linked to neighbors. No monolithic spec files.
- Behavior changed, spec updated — in the same PR. A stale spec is
  worse than no spec.
- PRs reference the spec. Review checks code and spec agree;
  divergence blocks merge.
- Write the WHY of decisions. Code shows what; spec shows why this
  approach and not the obvious alternative.

## Code style

- Functions: 4-20 lines. Split if longer.
- Files: under 500 lines. Split by responsibility.
- One thing per function, one responsibility per module (SRP).
- Names: specific and unique. Avoid `data`, `handler`, `Manager`.
  Prefer names that return <5 grep hits in the codebase.
- Types: explicit. No `any`, no `Dict`, no untyped functions.
- No code duplication. Extract shared logic into a function/module.
- Early returns over nested ifs. Max 2 levels of indentation.
- Exception messages must include the offending value and expected shape.

## Comments

- Keep your own comments. Don't strip them on refactor — they carry
  intent and provenance.
- Write WHY, not WHAT. Skip `// increment counter` above `i++`.
- Docstrings on public functions: intent + one usage example.
- Reference issue numbers / commit SHAs when a line exists because
  of a specific bug or upstream constraint.

## Tests

- Tests run with a single command: `<project-specific>`.
- Every new function gets a test. Bug fixes get a regression test.
- Mock external I/O (API, DB, filesystem) with named fake classes,
  not inline stubs.
- Tests must be F.I.R.S.T: fast, independent, repeatable,
  self-validating, timely.

## Dependencies

- Inject dependencies through constructor/parameter, not global/import.
- Wrap third-party libs behind a thin interface owned by this project.

## Structure

- Follow the framework's convention (Rails, Django, Next.js, etc.).
- Prefer small focused modules over god files.
- Predictable paths: controller/model/view, src/lib/test, etc.

## Formatting

- Use the language default formatter (`cargo fmt`, `gofmt`, `prettier`,
  `black`, `rubocop -A`). Don't discuss style beyond that.

## Logging

- Structured JSON when logging for debugging / observability.
- Plain text only for user-facing CLI output.

## Info page sync

- `src/lib/components/InfoPage.svelte` is the user-facing feature
  catalog. It must stay in sync with what the app actually does.
- Any change that adds, removes, or alters a user-visible feature
  (UI, shortcut, capability, limit, range) requires updating
  InfoPage in the same PR.
- Before adding a new entry, search InfoPage for an existing line
  that already covers the feature and update it instead of
  duplicating. After altering existing behavior (e.g. expanding a
  range, renaming an action), grep InfoPage for stale wording and
  fix it.
- Status values: `done`, `partial` (with `note`), `planned`. Don't
  mark something `done` until it ships.
