---
id: "39-004"
issue: 39
title: "Block auto-approve and review for PRs not ready for review"
depends_on: ["39-001", "39-003"]
---

## Description

Update the `autoApprove` method and the review gating logic in `src/orchestrator.ts` to respect the readiness marker in task-proposal PR bodies. When a PR is marked as not-ready-for-review, it should not be auto-approved or reviewed until the marker is changed to ready.

### Changes needed:

1. **`autoApprove` method:** Before merging a task-proposal PR, fetch the PR details (body) and check `isReadyForReview(pr.body)`. If not ready, skip auto-approve and log a message. Do NOT remove the `tasks-proposed` label — the PR should stay in `tasks-proposed` state until it becomes ready.

2. **`decideAction` method:** In the Priority 2 (auto-approve) section, fetch the PR for the `investigate/<N>` branch and check readiness. If the PR is not ready, skip this issue in the auto-approve loop (don't return an auto-approve action for it).

3. **Review gating in `investigate` method:** The existing code already skips review when not-ready (from task 39-003). This task ensures the auto-approve path also respects readiness.

4. **IssueProvider.getPRForBranch enhancement:** The current `getPRForBranch` return type includes `state`, `url`, and `number` but not `body`. Add `body: string` to the return type so that callers can inspect the PR body for the readiness marker without a separate API call.

## Acceptance Criteria

- `getPRForBranch` return type includes `body: string` in the interface and all implementations.
- `autoApprove` checks `isReadyForReview(pr.body)` and skips merge if not ready.
- `decideAction` skips auto-approve for issues whose task-proposal PR is not ready.
- When a not-ready PR exists, the orchestrator does not get stuck — it moves on to other actions (investigate other issues, implement tasks for other issues, etc.).
- When the PR body is later updated to include the ready marker (e.g., by a human editing the PR description), auto-approve works normally on the next run.
- Unit tests cover:
  - Auto-approve skipped when PR body has not-ready marker.
  - Auto-approve proceeds when PR body has ready marker.
  - Auto-approve proceeds when PR body has no marker (backward compatible).
  - `decideAction` skips not-ready PRs in auto-approve priority.

## Implementation Notes

- Modify `src/providers/issue-provider.ts`: add `body: string` to the `getPRForBranch` return type.
- Modify `src/providers/github.ts`: include `body` in the `getPRForBranch` implementation (the GitHub CLI `gh pr list` or `gh pr view` should already have this data available).
- Modify `src/orchestrator.ts`:
  - In `autoApprove`: after fetching the PR, check readiness before proceeding.
  - In `decideAction` Priority 2 loop: fetch the PR and check readiness before returning `auto-approve` action.
- Import `isReadyForReview` from `src/readiness.ts`.
- Update tests in `test/orchestrator.test.ts`.
