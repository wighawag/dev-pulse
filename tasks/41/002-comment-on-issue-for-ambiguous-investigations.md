---
id: "41-002"
issue: 41
title: "Comment on issue instead of creating PR when investigation is ambiguous"
depends_on: ["41-001"]
---

## Description

Modify the `investigate()` method in `src/orchestrator.ts` to check the `InvestigationResult` after the agent runs. When the result indicates ambiguity (`isClear === false` or `confidence < 0.7`), the orchestrator should:

1. **Comment on the issue** with the clarification questions instead of creating a PR.
2. **Add a new label** `whitesmith:needs-clarification` to the issue.
3. **NOT create a PR** — no branch push, no PR creation.
4. **Remove the `investigating` label** as usual.

When the result is clear, the existing behavior continues unchanged (push branch, create PR on `investigate/<number>`, label as `tasks-proposed`).

### Comment format

The comment posted on the issue should follow this template:

```markdown
🤔 I've analyzed this issue and need clarification before generating tasks:

- <question 1>
- <question 2>
- ...

**Next steps:**
1. **Edit this issue** to add clarification (preferred — I'll automatically re-analyze)
2. Or reply to this comment with more details

_Confidence: X.X/1.0_
```

### New label

Add `whitesmith:needs-clarification` to the `LABELS` constant in `src/types.ts`. This label signals that the agent is waiting for human input.

### Orchestrator changes

In the `investigate()` method, after the agent runs and before pushing:

```
1. Parse investigation result
2. If ambiguous:
   a. Comment on issue with questions
   b. Add needs-clarification label
   c. Remove investigating label
   d. Return (no branch push, no PR)
3. If clear:
   a. Continue with existing flow (push, create PR, label tasks-proposed)
```

## Acceptance Criteria

- When investigation is ambiguous, a comment is posted on the issue with clarification questions.
- When investigation is ambiguous, NO PR is created and NO branch is pushed.
- The `whitesmith:needs-clarification` label is added to ambiguous issues.
- The `investigating` label is removed in both clear and ambiguous cases.
- When investigation is clear, the existing behavior is unchanged (PR created, `tasks-proposed` label).
- The new `NEEDS_CLARIFICATION` label is included in `LABELS` and created via `ensureLabels`.
- Tests cover: ambiguous investigation flow (comment, no PR), clear investigation flow (unchanged).
- Dry-run mode outputs appropriate message for ambiguous investigations.

## Implementation Notes

- The `investigate()` method currently checks `tasks.length === 0` to detect failure. With ambiguity detection, 0 tasks is expected for ambiguous cases, so the flow needs to distinguish "agent failed" from "agent determined issue is ambiguous."
- The investigation result file is the signal: if it exists with `isClear: false`, it's ambiguous. If it doesn't exist and no tasks were created, it's a failure.
- Update `decideActionForIssue()` to handle the `needs-clarification` label — it should return `idle` (waiting for human input).
- Update `decideAction()` global scan to skip issues with `needs-clarification` label (add it to `allDevPulseLabels` filtering).
- Update dry-run output in both `run()` and `runForIssue()`.
- Files to modify: `src/orchestrator.ts`, `src/types.ts`.
