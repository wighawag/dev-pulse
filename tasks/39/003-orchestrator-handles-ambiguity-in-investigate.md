---
id: "39-003"
issue: 39
title: "Orchestrator handles ambiguity report during investigate phase"
depends_on: ["39-001", "39-002"]
---

## Description

Update the `investigate` method in `src/orchestrator.ts` to process the ambiguity report file (`.whitesmith-ambiguity.md`) after the agent completes investigation. Based on the report:

1. **If the issue is clear (READY: true or no ambiguity file):**
   - Create the task-proposal PR with the `<!-- whitesmith:ready-for-review -->` marker in the body (same flow as today, but with the marker added).
   - Proceed with review as normal.

2. **If the issue has ambiguities (READY: false):**
   - Create the task-proposal PR with the `<!-- whitesmith:not-ready-for-review -->` marker in the body.
   - Add a prominent notice in the PR body indicating it is NOT ready for review, listing the ambiguities and questions.
   - Post a comment on the **original issue** with the ambiguities and questions, asking the issue author to clarify.
   - Skip the review step (do not queue `reviewTaskProposal`).
   - Clean up the ambiguity report file (delete it so it's not committed).

3. **Clean up:** Always delete `.whitesmith-ambiguity.md` after reading it (before committing), so it doesn't end up in the PR.

## Acceptance Criteria

- When the agent produces a `READY: true` ambiguity report (or no report), the PR body contains the ready marker and the flow is unchanged from today.
- When the agent produces a `READY: false` ambiguity report:
  - The PR body contains the not-ready marker.
  - The PR body includes a section like "⚠️ This task proposal has unresolved ambiguities" with the list of ambiguities and questions.
  - A comment is posted on the original issue listing the ambiguities and asking for clarification.
  - The review step is skipped.
- The `.whitesmith-ambiguity.md` file is deleted before `git commitAll` so it's not included in the PR.
- Backward compatible: if the agent doesn't produce an ambiguity file (e.g., old prompt), behavior is identical to today (treated as ready).
- Unit tests cover:
  - Investigate with clear issue (ready) — PR has ready marker, review runs.
  - Investigate with ambiguous issue (not ready) — PR has not-ready marker, comment posted, review skipped.
  - Investigate with no ambiguity file — treated as ready (backward compatible).

## Implementation Notes

- Modify `src/orchestrator.ts`, specifically the `investigate` method.
- Read and parse `.whitesmith-ambiguity.md` using the `parseAmbiguityReport` function from task 39-002.
- Use `getReadinessMarker` and the marker constants from task 39-001.
- Delete the ambiguity file with `fs.unlinkSync` before calling `this.git.commitAll`.
- For the issue comment, format it nicely with markdown:
  ```
  🤔 **Ambiguity detected in this issue**
  
  While generating tasks, some aspects of this issue were found to be unclear:
  
  ### Ambiguities
  - ...
  
  ### Questions
  - ...
  
  Please clarify these points. The task proposal PR has been created but is marked as not ready for review.
  ```
- Update test mocks in `test/orchestrator.test.ts` following existing patterns.
