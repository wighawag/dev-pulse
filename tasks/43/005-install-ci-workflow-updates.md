---
id: "43-005"
issue: 43
title: "Update install-ci to generate workflows with new triggers and labels"
depends_on: ["43-003", "43-004"]
---

## Description

Update the `install-ci` command's workflow generators in `src/providers/github-ci.ts` to include the new trigger for ambiguous investigations. **Only the issue workflow generator needs changes.** The comment workflow, reconcile workflow, main workflow, and review workflow do NOT need changes.

### Changes to `generateIssueWorkflow()`

Update to trigger on both `opened` and `edited` events, with a condition on the job to only run on `edited` when the issue has the `needs-clarification` label:

```yaml
on:
  issues:
    types: [opened, edited]

jobs:
  run:
    if: >-
      github.event.action == 'opened' ||
      (github.event.action == 'edited' &&
       contains(join(github.event.issue.labels.*.name, ','), 'whitesmith:needs-clarification'))
    runs-on: ubuntu-latest
    steps:
      # ... existing steps unchanged ...
```

### Full conditional run job structure

The updated `run` job should look like this (the only changes from current are the `on` triggers and the `if` condition):

```yaml
jobs:
  run:
    if: >-
      github.event.action == 'opened' ||
      (github.event.action == 'edited' &&
       contains(join(github.event.issue.labels.*.name, ','), 'whitesmith:needs-clarification'))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: ./.github/actions/setup-whitesmith

      - run: |
          whitesmith run . \
            --issue "${{ github.event.issue.number }}" \
            --provider "$WHITESMITH_PROVIDER" \
            --model "$WHITESMITH_MODEL" \
            --max-iterations 10
```

The `whitesmith run` command is the same for both `opened` and `edited` events — no special flags needed. The orchestrator fetches the latest issue body automatically.

### No changes needed to other generators

- `generateCommentWorkflow()` — No changes. Comment-based re-investigation is not supported.
- `generateReconcileWorkflow()` — No changes.
- `generateMainWorkflow()` — No changes.
- `generateReviewWorkflow()` — No changes (if present).

### Files to modify

- `src/providers/github-ci.ts` — Update `generateIssueWorkflow()` only.

## Acceptance Criteria

- `install-ci` generates an issue workflow that triggers on both `opened` and `edited`
- The `edited` trigger is filtered to only run for issues with `needs-clarification` label via the job `if` condition
- The `run` job uses the same `whitesmith run` command for both triggers (no conditional steps needed)
- Existing workflow generation behavior is preserved for all non-issue workflows
- The generated workflow YAML is valid
- The `${{ }}` expressions are correctly escaped in the template literal (use `\${{ }}`)
- No changes to `generateCommentWorkflow()`, `generateReconcileWorkflow()`, `generateMainWorkflow()`, or `generateReviewWorkflow()`
- Test by running `install-ci --fake` and comparing the generated `whitesmith-issue.yml`

## Implementation Notes

- The `generateIssueWorkflow()` function uses template strings. Be careful with escaping `${{ }}` expressions — they need to use `\${{ }}` in the template literals to avoid JavaScript template literal interpolation.
- The `if` condition uses `>-` YAML multiline scalar syntax for readability.
- The existing concurrency group `whitesmith-issue-${{ github.event.issue.number }}` already works for both `opened` and `edited` events.
- The rest of the workflow (env block, permissions, steps) remains unchanged.
