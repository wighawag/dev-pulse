---
id: "41-001"
issue: 41
title: "Add ambiguity detection to investigate prompt and parse investigation results"
depends_on: []
---

## Description

Update the investigate prompt (`buildInvestigatePrompt` in `src/prompts.ts`) so the agent signals whether the generated tasks are clear or ambiguous. The agent should write a structured result file (`.whitesmith-investigation.json`) alongside the task files that includes:

- `isClear: boolean` — whether the issue is well-defined enough to implement
- `questions: string[]` — clarification questions when ambiguous
- `confidence: number` — confidence score (0.0–1.0)

Add a new interface `InvestigationResult` in `src/types.ts` and a parser function in a new file `src/investigation.ts` (or inline in orchestrator) that reads the result file and returns the parsed result.

### Changes to the investigate prompt

The prompt should instruct the agent to:
1. Analyze the issue for ambiguity, missing details, or unclear requirements.
2. Write `.whitesmith-investigation.json` with the structure above.
3. If `isClear` is true, proceed to create task files as before.
4. If `isClear` is false, do NOT create task files. Instead, populate `questions` with the specific clarifications needed.

### Parsing logic

Add a function (e.g., `parseInvestigationResult(workDir: string): InvestigationResult`) that:
1. Reads `.whitesmith-investigation.json` from the working directory.
2. Validates the required fields.
3. Falls back to `{ isClear: true, questions: [], confidence: 1.0 }` if the file doesn't exist (backward compat with agents that don't produce it).
4. Cleans up the file after reading.

## Acceptance Criteria

- `InvestigationResult` interface is defined in `src/types.ts` with `isClear`, `questions`, and `confidence` fields.
- `buildInvestigatePrompt` is updated to instruct the agent to produce `.whitesmith-investigation.json`.
- A parser function exists that reads and validates the investigation result file.
- Parser falls back gracefully when the file is missing (treats as clear).
- `.whitesmith-investigation*` is added to `.git/info/exclude` via `GitManager.ensureExcluded()`.
- Tests cover: parsing valid results, missing file fallback, malformed JSON handling.

## Implementation Notes

- The `.whitesmith-investigation.json` file should be excluded from git the same way `.whitesmith-*` files already are (see `GitManager.ensureExcluded()` — the existing `.whitesmith-*` pattern already covers this).
- Keep the prompt changes backward-compatible: if the agent doesn't produce the file, the orchestrator treats it as "clear" and proceeds normally.
- Look at how `review.ts` handles the `.whitesmith-review.md` response file for a similar pattern.
- The confidence threshold for ambiguity should be configurable later, but for now use a hardcoded threshold of 0.7.
- Files to modify: `src/types.ts`, `src/prompts.ts`. New code for parsing can go in a new `src/investigation.ts` or directly in orchestrator.
