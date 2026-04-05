---
id: "43-001"
issue: 43
title: "Add ambiguity detection to the investigate prompt and parse agent output"
depends_on: []
---

## Description

Modify the investigate phase so the agent can signal ambiguity/uncertainty, and add parsing logic to detect it.

Currently, `buildInvestigatePrompt()` in `src/prompts.ts` asks the agent to generate task files. There is no mechanism for the agent to say "I need clarification" instead. This task adds:

1. **Updated investigate prompt** — Tell the agent it can signal ambiguity by writing a special response file (`.whitesmith-ambiguity.md`) instead of creating task files. The response file should contain specific questions/clarifications needed, formatted in markdown.

2. **Ambiguity response parsing** — Add a standalone exported function `checkForAmbiguity(workDir: string): string | null` to detect whether the agent signaled ambiguity. After the agent runs during `investigate()`, check for the presence of `.whitesmith-ambiguity.md` at `path.join(workDir, '.whitesmith-ambiguity.md')`. If it exists, read its contents, delete the file, and return the content. If it doesn't exist, return `null`.

3. **New types** — Add an `InvestigateResult` type to `src/types.ts`:
   ```typescript
   export type InvestigateResult =
     | { outcome: 'tasks'; taskCount: number }
     | { outcome: 'ambiguous'; clarificationComment: string };
   ```
   Note: The `InvestigateResult` type is defined here for use in task 43-002. The `checkForAmbiguity()` function in this task returns `string | null` (the clarification content or null).

### Files to modify

- `src/prompts.ts` — Update `buildInvestigatePrompt()` to include instructions about the ambiguity escape hatch. The existing signature `(issue: Issue, issueTasksDir: string): string` does **not** change in this task. The prompt should tell the agent:
  - If the issue is clear, generate task files as before.
  - If the issue is ambiguous, unclear, or needs more information, write a file `.whitesmith-ambiguity.md` containing specific questions and do NOT create any task files. Do NOT commit anything.
  - The ambiguity file should be structured with a brief summary of what was understood, followed by numbered questions.

- `src/types.ts` — Add `InvestigateResult` type.

- `src/orchestrator.ts` — Add a **standalone exported function** `checkForAmbiguity(workDir: string): string | null` at the top of the file (or in a separate utility file). This function:
  - Checks if `path.join(workDir, '.whitesmith-ambiguity.md')` exists.
  - If yes: reads its contents, deletes the file, and returns the trimmed content string.
  - If no: returns `null`.
  - Requires `fs` and `path` imports. The `workDir` parameter is `config.workDir` (the repo root).
  - The `investigate()` method itself will be updated in task 43-002 to call this function and branch on the result.

## Acceptance Criteria

- `buildInvestigatePrompt()` includes clear instructions for the agent to signal ambiguity via `.whitesmith-ambiguity.md`
- The prompt tells the agent NOT to create task files and NOT to commit when signaling ambiguity
- An `InvestigateResult` type is defined in `src/types.ts`
- A standalone exported function `checkForAmbiguity(workDir: string): string | null` exists in `src/orchestrator.ts`
- The function reads `.whitesmith-ambiguity.md` from `path.join(workDir, '.whitesmith-ambiguity.md')`, returns its content, and deletes the file
- The function returns `null` when the file doesn't exist
- `.whitesmith-ambiguity.md` is excluded from git commits (it's already covered by `.whitesmith-*` in `ensureExcluded()` in `git.ts` — add a test to verify this pattern matches)
- Unit tests for the ambiguity detection helper in `test/orchestrator.test.ts` (reads file, returns content, cleans up; returns null when no file)
- Unit tests for the updated prompt in `test/prompts.test.ts` (contains ambiguity instructions, mentions `.whitesmith-ambiguity.md`)
- Existing `buildInvestigatePrompt` tests still pass

## Implementation Notes

- The `.whitesmith-*` pattern is already in `git.ts`'s `ensureExcluded()` method, so `.whitesmith-ambiguity.md` will automatically be excluded from git tracking. Worth adding a test to confirm this.
- Follow the same pattern as `.whitesmith-response.md` and `.whitesmith-review.md` used in `comment.ts` and `review.ts` — read file, extract content, delete file.
- The prompt update should be additive — the existing task-generation instructions remain, with a new section added for the ambiguity path.
- Add the prompt tests to `test/prompts.test.ts`.
- Add the `checkForAmbiguity` function tests to `test/orchestrator.test.ts`. Note that the test helper `createConfig()` in this file currently doesn't include `provider` or `model` fields — they aren't needed for testing `checkForAmbiguity` since it's a standalone function that only takes `workDir`.
- The `checkForAmbiguity` function is independent of the `Orchestrator` class and can be tested without mocking the class.
