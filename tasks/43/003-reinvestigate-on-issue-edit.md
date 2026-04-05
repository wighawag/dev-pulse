---
id: "43-003"
issue: 43
title: "Re-investigate on issue edit when needs-clarification"
depends_on: ["43-002"]
---

## Description

Add a workflow trigger and orchestrator logic to re-investigate an issue when the user provides clarification by editing the issue body. **Only issue edits trigger re-investigation — comment-based re-investigation is not supported.**

### 1. GitHub Actions workflow changes

**`.github/workflows/whitesmith-issue.yml`** — Currently triggers only on `issues.opened`. Add `issues.edited` as a trigger:

```yaml
on:
  issues:
    types: [opened, edited]
```

Add a condition to the job: on `edited` events, only run if the issue has the `whitesmith:needs-clarification` label (to avoid re-investigating every issue edit):

```yaml
jobs:
  run:
    if: >-
      github.event.action == 'opened' ||
      (github.event.action == 'edited' &&
       contains(join(github.event.issue.labels.*.name, ','), 'whitesmith:needs-clarification'))
    runs-on: ubuntu-latest
```

### 2. Orchestrator changes

**`decideActionForIssue()`** — Update the behavior for `needs-clarification` from `idle` (set in 43-002) to `investigate`. When an issue has the `needs-clarification` label, return `{type: 'investigate', issue}` so the full investigation flow runs again. **Update the test from 43-002 that asserted idle behavior to now assert investigate behavior.**

**`investigate()`** — At the start, if the issue has the `needs-clarification` label, remove it before proceeding. This ensures the issue goes through the full investigation flow again with the updated issue body. The label removal should happen after the `investigating` label is added (existing behavior), so the sequence is:
1. Add `investigating` label (existing)
2. Check and remove `needs-clarification` label if present (new)
3. Proceed with agent run

### 3. No changes to CLI, prompt, or comment workflow

Since re-investigation is triggered only by issue edits:
- No `--comment-body` or `--comment-body-file` CLI flags are needed
- No changes to `DevPulseConfig` for comment body
- No changes to `buildInvestigatePrompt()` signature — the updated issue body is already available via the standard issue fetch
- No changes to the comment workflow (`.github/workflows/whitesmith-comment.yml`)

### Files to modify

- `.github/workflows/whitesmith-issue.yml` — Add `edited` trigger with label filter condition on the job.
- `src/orchestrator.ts` — Update `decideActionForIssue()` to return `investigate` for `needs-clarification` issues. Update `investigate()` to remove `needs-clarification` label at the start.
- `test/orchestrator.test.ts` — Update the test from 43-002 for `needs-clarification` idle behavior to now assert `investigate` behavior. Add tests for label removal during re-investigation.

## Acceptance Criteria

- Issue edit triggers the whitesmith-issue workflow when issue has `needs-clarification` label
- Issue edit does NOT trigger the workflow for issues without `needs-clarification` label
- `decideActionForIssue()` returns `{type: 'investigate', issue}` for `needs-clarification` issues
- The `needs-clarification` label is removed at the start of `investigate()` when present
- The re-investigation uses the updated issue body (no special context passing needed — standard issue fetch gets the latest body)
- The re-investigation follows the same ambiguity detection flow (can result in another clarification comment or proceed to create a PR with tasks)
- Unit tests cover:
  - `decideActionForIssue` returns `investigate` for `needs-clarification` issues
  - `investigate()` removes the `needs-clarification` label when present
  - Normal investigate flow (no `needs-clarification` label) is unchanged
- Workflow file has correct trigger conditions and filtering

## Implementation Notes

- For the workflow condition, use `contains(join(github.event.issue.labels.*.name, ','), 'whitesmith:needs-clarification')` to check the label.
- The workflow concurrency group `whitesmith-issue-${{ github.event.issue.number }}` already handles preventing concurrent runs for the same issue — the `edited` trigger reuses the same group.
- Since the `whitesmith run --issue N` command fetches the issue fresh, the updated description is automatically available without any special passing.
