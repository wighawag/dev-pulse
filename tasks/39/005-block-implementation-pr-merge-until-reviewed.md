---
id: "39-005"
issue: 39
title: "Ensure implementation PRs are not merged until review is done in auto-work mode"
depends_on: ["39-001"]
---

## Description

The issue states: "no PR should be merged until review is done" in auto-work mode. Currently, implementation PRs (created when all tasks are completed on an `issue/<N>` branch) don't go through an auto-merge flow like task-proposal PRs do — they are created and left for human merge or the reconcile step. However, we need to ensure the review step completes before any auto-merge logic could apply.

Review the current flow:
1. Implementation PRs are created in the `implement` method when all tasks are done.
2. A review is queued via `reviewImplementationPR` immediately after PR creation.
3. The `reconcile` method only creates PRs as a safety net — it doesn't merge them.

The current flow already doesn't auto-merge implementation PRs. But to make this explicit and future-proof:

1. **Add the readiness marker to implementation PRs:** When creating the implementation PR in `implement` and `reconcile`, include `<!-- whitesmith:ready-for-review -->` in the body. This signals that the implementation is ready for review (the tasks were clear enough to implement).

2. **Add the readiness marker to task-proposal PRs created in `investigate`:** Ensure all PRs created by whitesmith include the appropriate readiness marker based on the ambiguity assessment (this builds on task 39-003 but covers the implementation PR path as well).

3. **Document the convention:** Add a brief section in the `README.md` explaining the readiness marker system and how it affects the workflow.

## Acceptance Criteria

- Implementation PRs created in `implement` method include `<!-- whitesmith:ready-for-review -->` in their body.
- Implementation PRs created in `reconcile` method (safety net) include `<!-- whitesmith:ready-for-review -->` in their body.
- README.md has a section explaining the readiness marker system:
  - What the markers are
  - How they affect auto-approve
  - How they affect review
  - How to manually change readiness (edit PR description)
- All existing tests still pass.
- New tests verify implementation and reconcile PR bodies contain the ready marker.

## Implementation Notes

- Modify `src/orchestrator.ts`:
  - In `implement` method, where `createPR` is called, add the ready marker to the body.
  - In `reconcile` method, where `createPR` is called, add the ready marker to the body.
- Import `getReadinessMarker` or `READY_FOR_REVIEW_MARKER` from `src/readiness.ts`.
- Update `README.md` with a new section about ambiguity resolution and readiness markers.
- Update relevant tests in `test/orchestrator.test.ts`.
