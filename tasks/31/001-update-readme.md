---
id: "31-001"
issue: 31
title: "Update README to match current feature set"
depends_on: []
---

## Description

The README.md is significantly out of date and does not reflect the current feature set of whitesmith. It needs a comprehensive rewrite to document all commands, options, workflows, and features that exist in the codebase.

### What's missing or outdated:

#### New CLI Commands (not documented at all)
1. **`whitesmith comment`** — Handles comments on issues and PRs. Supports `--number`, `--body`, `--body-file`, `--post`, and standard agent options. Auto-detects whether the target is a PR or issue and handles each appropriately.
2. **`whitesmith review`** — Reviews PRs, task proposals, or completed task implementations. Supports `--number`, `--type` (pr, issue-tasks, issue-tasks-completed — auto-detected if omitted), `--post`, and standard agent options. Produces a verdict (APPROVE or REQUEST_CHANGES).
3. **`whitesmith install-ci`** — Interactive setup wizard that generates GitHub Actions workflows, composite actions, and sets GitHub secrets. Supports two auth modes (`--auth-json` for pi auth.json, default `models-json`), `--fake` (write to `.fake/` for testing), `--config` (load from JSON), `--export-config` / `--include-secrets`, `--no-secrets`, `--dev` (build from source), `--review-workflow`, `--no-review-step`.

#### Missing `run` command options
- `--dry-run` — Print what would be done without executing
- `--auto-work` — Enable auto-work mode (auto-approve task PRs)
- `--no-review` — Disable review step after PRs are created

#### Missing features & concepts
- **Auto-work mode**: Issues can enable auto-work via the `whitesmith:auto-work` label, the `whitesmith:auto-work` string in the issue body, or the `--auto-work` CLI flag. When enabled, task proposal PRs are automatically merged (with optional review first).
- **Review system**: After creating task proposal PRs or implementation PRs, whitesmith can automatically run a review using the AI agent. Reviews produce a verdict (APPROVE or REQUEST_CHANGES). Controlled by `--no-review` flag.
- **`/whitesmith` slash command trigger**: In the comment workflow, comments containing `/whitesmith` trigger the agent. Comments on whitesmith-managed PR branches (`investigate/*` or `task/*`) also trigger automatically.
- **Branch naming convention**: `investigate/<issue-number>` for task proposals, `issue/<issue-number>` for implementations. This should be documented.
- **models.json auth mode**: Alternative to auth.json — configure providers in `~/.pi/agent/models.json` with provider name, base URL, API type, and models. This is the default mode for `install-ci`.

#### GitHub Actions section is outdated
The README contains a manually written workflow example that is outdated and doesn't match the current architecture. The actual system:
- Uses `whitesmith install-ci` to generate workflows interactively
- Generates a **composite action** at `.github/actions/setup-whitesmith/action.yml` (shared setup: Node.js, git config, install whitesmith + pi, configure auth)
- Generates **4 workflows** (+ optional 5th):
  - `whitesmith.yml` — Main loop (schedule + manual dispatch)
  - `whitesmith-comment.yml` — Respond to issue/PR comments
  - `whitesmith-reconcile.yml` — Reconcile on PR merge
  - `whitesmith-review.yml` — (optional) Review PRs on open/synchronize
- Supports two auth modes: `models-json` (API keys as individual GitHub secrets) and `auth-json` (PI_AUTH_JSON secret + OAuth refresh script)
- Supports npm caching for faster CI runs
- Supports dev mode (build from source via pnpm)

The README should replace the manual workflow YAML with documentation about `install-ci` and briefly describe what gets generated.

#### Issue lifecycle update
The auto-approve step should be mentioned in the lifecycle:
```
(new issue, no labels)
  → whitesmith:investigating    — agent is generating tasks
  → whitesmith:tasks-proposed   — task PR opened for review
  → whitesmith:tasks-accepted   — task PR merged (or auto-approved), implementation begins
  → whitesmith:completed        — all tasks done, issue closed
```

#### Labels section
Document the `whitesmith:auto-work` label alongside the existing lifecycle labels.

## Acceptance Criteria

- All CLI commands are documented: `run`, `status`, `reconcile`, `comment`, `review`, `install-ci`
- All options for each command are listed in a table or list format
- The `comment` command documentation explains PR vs issue comment handling, `--body` vs `--body-file`, and `--post` behavior
- The `review` command documentation explains the three review types and auto-detection
- The `install-ci` command documentation explains both auth modes, the interactive setup, `--config`/`--export-config` for non-interactive use, and what files are generated
- Auto-work mode is documented (label, issue body trigger, CLI flag)
- The review system is documented (automatic reviews, verdicts, `--no-review` to disable)
- The `/whitesmith` slash command trigger is documented
- Branch naming convention (`investigate/<N>`, `issue/<N>`) is documented
- The GitHub Actions section is updated to describe `install-ci` and the generated workflow architecture (composite action, 4-5 workflows)
- The manual workflow YAML is removed or replaced with a brief quickstart using `install-ci`
- models.json auth mode is documented as an alternative to auth.json
- Issue lifecycle includes auto-approve step
- `whitesmith:auto-work` label is documented
- The `--dry-run`, `--auto-work`, and `--no-review` run options are documented
- README structure remains clear and scannable
- No features from the codebase are left undocumented

## Implementation Notes

- The single file to modify is `README.md` at the repository root.
- Refer to `src/cli.ts` for the definitive list of commands and options.
- Refer to `src/types.ts` for labels and config interface.
- Refer to `src/auto-work.ts` for auto-work trigger conditions.
- Refer to `src/review.ts` for review types and verdicts.
- Refer to `src/comment.ts` for comment handling behavior.
- Refer to `src/providers/github-ci.ts` for install-ci functionality and generated workflow structure.
- Refer to `src/orchestrator.ts` for the full orchestration loop and action priority.
- Keep the existing README structure (How It Works → Installation → Setup → Usage → GitHub Actions → Task File Format → Development → License) but expand sections as needed.
- The options tables for `run` should be updated to include the new flags.
- For `install-ci`, consider showing a quick example of interactive usage and non-interactive usage with `--config`.
