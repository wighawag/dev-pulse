---
id: "47-001"
issue: 47
title: "Make needs-clarification go idle in single-issue mode instead of re-investigating"
depends_on: []
---

## Description

When the orchestrator marks an issue as ambiguous, it adds the `whitesmith:needs-clarification` label and posts a comment asking for clarification. However, in the same run loop (single-issue mode via `runForIssue`), the next iteration re-fetches the issue, sees the `needs-clarification` label, and immediately re-investigates — even though no human has provided clarification yet.

The bug is in the `decideActionForIssue` method in `src/orchestrator.ts`. The current code:

```typescript
// needs-clarification: re-investigate with updated issue body
if (labels.includes(LABELS.NEEDS_CLARIFICATION)) {
    return {type: 'investigate', issue};
}
```

This should instead return `{type: 'idle'}` because:
- The `needs-clarification` label means "waiting for human input"
- Re-investigation after clarification is handled externally by the `whitesmith-issue.yml` workflow, which triggers a *new* `whitesmith run` when the issue is edited while it has the `needs-clarification` label
- Within the same run loop, re-investigating without new input wastes iterations and produces the exact same ambiguity result again

## Acceptance Criteria

- When `decideActionForIssue` encounters an issue with the `whitesmith:needs-clarification` label (and no `whitesmith:needs-human-review` label), it returns `{type: 'idle'}` instead of `{type: 'investigate', issue}`.
- The existing test `'re-investigates when issue has needs-clarification label'` must be updated to expect idle behavior instead of re-investigation (or replaced with a new test that verifies idle).
- A new test should verify that single-issue mode goes idle when an issue has only the `needs-clarification` label.
- The existing test `'goes idle when issue has needs-human-review label'` should continue to pass (that issue has both `needs-clarification` AND `needs-human-review`, and `needs-human-review` is checked first — already returns idle).
- The tests `'removes needs-clarification label during re-investigation before agent runs'` and `'does not remove needs-clarification label during normal investigation'` may need to be updated or removed since re-investigation from `needs-clarification` no longer happens in the same run loop.
- All existing tests must pass (`pnpm test`).

## Implementation Notes

### File to modify: `src/orchestrator.ts`

In the `decideActionForIssue` method, change:

```typescript
// needs-clarification: re-investigate with updated issue body
if (labels.includes(LABELS.NEEDS_CLARIFICATION)) {
    return {type: 'investigate', issue};
}
```

To:

```typescript
// needs-clarification: wait for human to edit the issue (triggers a new run via whitesmith-issue.yml)
if (labels.includes(LABELS.NEEDS_CLARIFICATION)) {
    return {type: 'idle'};
}
```

### Important context about the `investigate` method

The `investigate` method still has code to handle re-investigation when `needs-clarification` is present (removing the label at the start of investigation). This code path is still valid — it gets triggered when a **new** `whitesmith run` is started by the `whitesmith-issue.yml` workflow after the human edits the issue. In that new run, the issue will have `needs-clarification`, and the workflow's `if` condition checks for this label on `edited` events. But in that new run, you'd want the orchestrator to re-investigate.

So the fix requires a way to distinguish between:
1. A **new run** triggered by an issue edit (should re-investigate) — the `whitesmith-issue.yml` workflow only triggers on `issues: [opened, edited]` and only runs when the issue has `needs-clarification` on edit
2. A **subsequent iteration** in the same run after just marking it ambiguous (should idle)

The simplest approach: since `whitesmith-issue.yml` re-triggers the entire `whitesmith run` command from scratch, and the issue will still have `needs-clarification` at that point, the `decideActionForIssue` needs to re-investigate in that case. 

**Better approach:** Track whether the orchestrator itself just added the `needs-clarification` label in this run. One clean way: add instance state (e.g., a `Set<number>` of issue numbers marked as needing clarification in this run). When `investigate()` adds `NEEDS_CLARIFICATION`, record the issue number. In `decideActionForIssue`, if the issue has `needs-clarification` AND is in the "just-marked" set, return idle. Otherwise, return investigate (for the re-triggered run case).

**Simplest correct approach:** Since `runForIssue` always re-fetches the issue from GitHub before deciding, and the `investigate()` method adds the `needs-clarification` label via the API, the re-fetched issue in the next iteration will have the label. But in a fresh run triggered by issue edit, the issue will also have the label. So we need the instance-level tracking.

Add a private field to the `Orchestrator` class:

```typescript
private clarificationPostedFor = new Set<number>();
```

In the `investigate` method, where it handles ambiguity and adds `NEEDS_CLARIFICATION`, also add:

```typescript
this.clarificationPostedFor.add(issue.number);
```

In `decideActionForIssue`, change the `NEEDS_CLARIFICATION` handling to:

```typescript
if (labels.includes(LABELS.NEEDS_CLARIFICATION)) {
    if (this.clarificationPostedFor.has(issue.number)) {
        return {type: 'idle'};
    }
    return {type: 'investigate', issue};
}
```

This way:
- Same run after posting clarification → idle (correct: don't re-investigate without new info)
- New run triggered by issue edit → re-investigate (correct: human may have provided clarification)

### File to modify: `test/orchestrator.test.ts`

1. **Update** the test `'re-investigates when issue has needs-clarification label'` — this test simulates a fresh run with an issue that has `needs-clarification`. It should still expect re-investigation (the fix only prevents re-investigation in the *same* run).

2. **Add a new test** in the `single-issue mode` describe block that verifies: when the agent signals ambiguity in iteration 1, iteration 2 goes idle. Use `maxIterations: 2`, have the agent signal ambiguity, and verify the agent is only called once (in iteration 1), not twice.

3. **Keep** the existing tests for `'removes needs-clarification label during re-investigation before agent runs'` and `'does not remove needs-clarification label during normal investigation'` — these test the behavior when a fresh run encounters `needs-clarification`, which is still valid.

### Build

After making changes, run:
```bash
pnpm build
pnpm test
```
