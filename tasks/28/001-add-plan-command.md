---
id: "28-001"
issue: 28
title: "Add `plan` CLI command for local task generation from a description"
depends_on: []
---

## Description

Add a new `plan` CLI command to whitesmith that accepts an issue/task description via the command line and generates task files locally — similar to the `investigate` phase but without any GitHub interaction, issue creation, or branch management.

The `plan` command:
- Accepts a description via `--description <text>` or `--description-file <path>` (one is required)
- Accepts an optional `--id <number>` to set the task directory name (defaults to a generated local ID, e.g. timestamp-based or `local`)
- Works on the **current branch** — does not create or switch branches
- Runs the AI agent to generate task files into `tasks/<id>/` (same format as `investigate`)
- Does **not** interact with GitHub at all (no labels, no PRs, no issue creation)
- Commits the generated tasks locally (same pattern as `investigate`)
- Requires `--provider` and `--model` (same as other agent commands)
- Optionally accepts `--agent-cmd` and `--log-file`

### What needs to change

1. **`src/prompts.ts`** — Add a new `buildPlanPrompt()` function. This should be very similar to `buildInvestigatePrompt()` but:
   - Takes a description string and an ID (instead of an `Issue` object)
   - Does not reference a GitHub issue URL or number (or uses the provided ID as a pseudo-issue number)
   - Uses the same task file format and directory structure
   - The commit message should be `tasks(<id>): generate implementation tasks` (same pattern)

2. **`src/cli.ts`** — Add a new `plan` subcommand to the Commander program:
   ```
   whitesmith plan [work_dir]
     --description <text>       Description of what to implement (or use --description-file)
     --description-file <path>  Read description from a file
     --id <identifier>          Task directory identifier (default: "plan" or auto-generated)
     --agent-cmd <cmd>          Agent harness command (default: "pi")
     --provider <name>          AI provider (required)
     --model <id>               AI model ID (required)
     --log-file <path>          Log agent output to file
   ```

   The command handler should:
   1. Read the description from `--description` or `--description-file`
   2. Resolve the working directory
   3. Create the `PiHarness` and validate the agent
   4. Build the prompt using `buildPlanPrompt()`
   5. Run the agent
   6. Verify task files were created using `TaskManager`
   7. Commit the task files with `git add tasks/ && git commit -m "tasks(<id>): generate implementation tasks"`
   8. Print a summary of generated tasks

3. **`src/prompts.ts` exports** — Export `buildPlanPrompt` from `src/index.ts`

## Acceptance Criteria

- Running `whitesmith plan --description "Add feature X" --provider anthropic --model claude-opus-4-6` generates task files in `tasks/<id>/` on the current branch
- Running `whitesmith plan --description-file feature.md --provider anthropic --model claude-opus-4-6` reads the description from a file
- The `--id` option controls the task directory name (e.g. `--id 99` → `tasks/99/`)
- If neither `--description` nor `--description-file` is provided, the command errors with a helpful message
- The command does **not** interact with GitHub (no issue creation, no labels, no PRs, no branch switching)
- The command stays on the current branch
- Generated task files follow the same format as `investigate` (YAML frontmatter with id, issue, title, depends_on)
- After agent runs, tasks are committed locally
- `whitesmith plan --help` shows usage information
- The `buildPlanPrompt()` function is exported from `src/index.ts`

## Implementation Notes

- Follow the same patterns as the existing `comment` and `review` commands in `cli.ts` for option handling
- The `buildPlanPrompt()` function should closely mirror `buildInvestigatePrompt()` but substitute the Issue fields with the provided description and ID
- Use `TaskManager.listTasks(id)` to verify tasks were created (the ID will be used as the "issue number" equivalent)
- For the default ID when `--id` is not provided, consider using `"plan"` as a simple default, or a timestamp like `Date.now()`. Using `"plan"` is simpler but means re-running overwrites; a numeric default is safer. The task description in the prompt should instruct the agent to use the ID in the task frontmatter's `issue` field.
- The `GitManager` is used only for `commitAll()` — no branch switching, no fetch, no push
- Do NOT add any `--no-push` logic since there's nothing to push — the command is purely local
