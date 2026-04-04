---
id: "39-001"
issue: 39
title: "Add readiness marker to task-proposal PR body and detection utilities"
depends_on: []
---

## Description

Add a standardized readiness marker system that can be embedded in PR bodies to indicate whether a task proposal is ready for review or still has unresolved ambiguities.

Define two marker constants:
- `<!-- whitesmith:ready-for-review -->` — indicates the task proposal is clear and ready for review
- `<!-- whitesmith:not-ready-for-review -->` — indicates the task proposal has ambiguities that need clarification

These are HTML comments so they are invisible in the rendered PR body but machine-parseable.

Add utility functions to:
1. Check if a PR body contains a readiness marker
2. Determine if a PR is marked as ready or not-ready
3. Generate the appropriate marker string

## Acceptance Criteria

- Two new constants are defined in `src/types.ts` (or a new `src/readiness.ts` module): `READY_FOR_REVIEW_MARKER` and `NOT_READY_FOR_REVIEW_MARKER`.
- A function `isReadyForReview(prBody: string): boolean` returns `true` when the body contains the ready marker (or no marker at all for backward compatibility), and `false` when it contains the not-ready marker.
- A function `getReadinessMarker(ready: boolean): string` returns the appropriate HTML comment marker.
- Unit tests cover:
  - PR body with ready marker → `isReadyForReview` returns `true`
  - PR body with not-ready marker → `isReadyForReview` returns `false`
  - PR body with no marker → `isReadyForReview` returns `true` (backward compatible)
  - PR body with both markers → `isReadyForReview` returns `false` (not-ready takes precedence)
  - `getReadinessMarker(true)` returns the ready marker
  - `getReadinessMarker(false)` returns the not-ready marker

## Implementation Notes

- Create a new file `src/readiness.ts` with the constants and utility functions.
- Create a corresponding test file `test/readiness.test.ts`.
- The markers should be HTML comments (`<!-- ... -->`) so they don't render in GitHub's PR view but are easily parseable.
- Export from `src/index.ts` if there is one, following existing patterns.
