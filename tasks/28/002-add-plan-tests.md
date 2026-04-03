---
id: "28-002"
issue: 28
title: "Add tests for the `plan` command and `buildPlanPrompt`"
depends_on: ["28-001"]
---

## Description

Add unit tests for the new `plan` command functionality introduced in task 28-001. This includes testing the `buildPlanPrompt()` function and the CLI command option parsing/validation.

### What needs to be tested

1. **`buildPlanPrompt()` tests** (in a new or existing test file, e.g. `test/prompts.test.ts`):
   - Generates a prompt containing the provided description text
   - Uses the provided ID in the task directory path (`tasks/<id>/`)
   - Uses the ID in the task file format examples (frontmatter `id` and `issue` fields)
   - Contains the same task file format instructions as `buildInvestigatePrompt`
   - Contains commit instructions

2. **CLI option validation tests** (in `test/integration.test.ts` or a new `test/plan.test.ts`):
   - `whitesmith plan --help` exits successfully and shows help text
   - Errors when neither `--description` nor `--description-file` is provided
   - Errors when `--description-file` points to a nonexistent file
   - Accepts `--description` as a text argument
   - Accepts `--description-file` as a file path
   - The `--id` option defaults correctly when not provided

## Acceptance Criteria

- `buildPlanPrompt()` has at least 3 unit tests covering description inclusion, ID usage, and task format instructions
- CLI validation is tested: missing description error, nonexistent file error, help output
- All tests pass with `pnpm test`
- Tests follow existing patterns in `test/prompts.test.ts` and other test files

## Implementation Notes

- Look at existing tests in `test/prompts.test.ts` for patterns on testing prompt builders
- Look at `test/integration.test.ts` for patterns on testing CLI commands (if any CLI tests exist)
- The `buildPlanPrompt` tests should be straightforward string-contains assertions
- For CLI tests, you may need to import `buildCli()` from `src/cli.ts` and call `parseAsync()` with test args, or use snapshot-style testing
- Keep tests focused and fast — no actual agent execution needed
