---
id: "43-003"
issue: 43
title: "Re-investigate on issue edit when needs-clarification"
depends_on: ["43-002"]
---

## Description

Add a workflow trigger and orchestrator logic to re-investigate an issue when the user provides clarification by editing the issue body.

### 1. GitHub Actions workflow changes

**`whitesmith-issue.yml`** — Currently triggers only on `issues.opened`. Add `issues.edited` as a trigger:

```yaml
on:
  issues:
    types: [opened, edited]
```

Add a condition to the job: on `edited` events, only run if the issue has the `whitesmith:needs-clarification` label (to avoid re-investigating every issue edit).

### 2. Orchestrator changes

**`decideActionForIssue()`** — When an issue has the `needs-clarification` label, treat it as ready for re-investigation (return `investigate` action) instead of idle. The label should be removed at the start of `investigate()` so the normal investigation flow proceeds.

**`investigate()`** — At the start, if the issue has the `needs-clarification` label, remove it before proceeding. This ensures the issue goes through the full investigation flow again.

### Files to modify

- `.github/workflows/whitesmith-issue.yml` — Add `edited` trigger with label filter.
- `src/orchestrator.ts` — Update `decideActionForIssue()` to handle `needs-clarification` label. Update `investigate()` to remove the label.

## Acceptance Criteria

- Issue edit triggers re-investigation when issue has `needs-clarification` label
- Issue edit does NOT trigger re-investigation for issues without `needs-clarification` label
- The `needs-clarification` label is removed when re-investigation starts
- The re-investigation uses only the updated issue body (no comment context needed)
- The re-investigation follows the same ambiguity detection flow (can still result in another clarification comment)
- Unit tests cover: `decideActionForIssue` returns `investigate` for `needs-clarification` issues, `investigate()` removes the label
- Workflow file has correct trigger conditions and filtering

## Implementation Notes

- For the issue edit workflow, use GitHub Actions' `if` condition with `contains(join(github.event.issue.labels.*.name, ','), 'whitesmith:needs-clarification')` to filter.
- Since re-investigation is only triggered by issue edits, no changes are needed to the comment workflow, the CLI, or the prompt signature.
- The updated issue body is already available to the agent via the standard issue fetch — no special context passing is needed.
