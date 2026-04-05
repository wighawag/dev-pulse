---
id: "41-003"
issue: 41
title: "Add issues.edited webhook trigger to re-investigate after clarification"
depends_on: ["41-002"]
---

## Description

Add a new GitHub Actions workflow (`whitesmith-issue-edited.yml`) that triggers on `issues.edited` events. When a user edits an issue that has the `whitesmith:needs-clarification` label, the workflow should re-trigger investigation by running `whitesmith run . --issue <number>`.

### Workflow: `.github/workflows/whitesmith-issue-edited.yml`

The workflow should:

1. Trigger on `issues.edited` events.
2. Check if the issue has the `whitesmith:needs-clarification` label.
3. If yes, remove the `needs-clarification` label and run `whitesmith run . --issue <number>`.
4. If no, skip (the edit is unrelated to whitesmith).

### Orchestrator changes

Update `decideActionForIssue()` in `src/orchestrator.ts` to handle re-investigation:

- When an issue has the `needs-clarification` label removed (or has no whitesmith labels after label removal), it should be treated as a new issue ready for investigation.
- The existing code path for "no whitesmith labels → investigate" already handles this, but we need to ensure the `needs-clarification` label is removed before running the orchestrator so it re-investigates.

The label removal should happen in the workflow YAML (before calling `whitesmith run`), keeping the orchestrator simple.

### Ambiguity count tracking

To prevent infinite loops (issue edited but still ambiguous), track the number of ambiguity cycles:

1. Add a new label format: `whitesmith:ambiguity-count-N` (e.g., `whitesmith:ambiguity-count-1`).
2. In the `investigate()` method, when posting an ambiguity comment, increment the count.
3. When the count reaches 3, add `whitesmith:needs-human-review` label and do NOT auto-investigate again.
4. The workflow should check for `needs-human-review` and skip if present.

**Alternative (simpler):** Instead of label-based tracking, count the number of existing whitesmith bot comments on the issue that match the ambiguity comment pattern. This avoids label proliferation.

**Recommended approach:** Use a simple counter in the ambiguity comment itself. When re-investigating, the orchestrator checks the existing comment count. If >= 3 ambiguity comments found, stop and label as `needs-human-review`.

## Acceptance Criteria

- A new workflow file `.github/workflows/whitesmith-issue-edited.yml` exists.
- The workflow triggers on `issues.edited` and checks for the `needs-clarification` label.
- The workflow removes `needs-clarification` before running the orchestrator.
- Re-investigation works end-to-end: edit issue → workflow fires → agent re-analyzes → either creates PR or posts new clarification comment.
- Infinite loop prevention: after 3 ambiguity cycles, adds `whitesmith:needs-human-review` label and stops.
- The `needs-human-review` label is added to `LABELS` in `src/types.ts` and created via `ensureLabels`.
- `decideActionForIssue()` returns `idle` for issues with `needs-human-review` label.
- Concurrency group uses `whitesmith-issue-${{ number }}` to prevent parallel runs.

## Implementation Notes

- Model the workflow after the existing `whitesmith-issue.yml` workflow but with `issues: [edited]` trigger.
- The workflow needs a `check` job similar to `whitesmith-comment.yml` that verifies the label exists before running.
- Use `gh issue edit $NUMBER --remove-label "whitesmith:needs-clarification"` in the workflow before the whitesmith run.
- For ambiguity count tracking, the simplest approach: in `investigate()`, before posting the ambiguity comment, use `gh issue view $NUMBER --comments --json comments` to count previous ambiguity comments. If >= 3, label as `needs-human-review` instead.
- However, loading comments adds context. A simpler alternative: use a dedicated label `whitesmith:ambiguity-count-N` and parse N. When posting, increment. When N >= 3, switch to `needs-human-review`.
- Files to create: `.github/workflows/whitesmith-issue-edited.yml`.
- Files to modify: `src/orchestrator.ts`, `src/types.ts`.
- Consider updating `install-ci` (in `src/providers/github-ci.ts`) to generate the new workflow when installing CI.
