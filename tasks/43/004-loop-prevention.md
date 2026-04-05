---
id: "43-004"
issue: 43
title: "Add loop prevention for repeated ambiguity cycles"
depends_on: ["43-002"]
---

## Description

Add loop prevention to stop the system from endlessly cycling between "needs clarification" and "re-investigate" when the user's responses don't resolve the ambiguity.

### Mechanism

Track the number of ambiguity cycles by counting bot clarification comments on the issue. When the cycle count reaches a threshold (default: 3), the system should:

1. Stop auto-investigating
2. Add a `whitesmith:needs-human-review` label
3. Post a final comment explaining that human intervention is needed
4. Do NOT remove the `needs-clarification` label (so `decideAction` still skips it)

### Counting cycles

Before posting a new clarification comment, count existing bot comments that match the clarification template pattern (e.g., start with "🤔 I've analyzed this issue"). Use the `listComments` method (added in this task) to fetch comments.

The TypeScript implementation should:
1. Call `gh issue view <number> --json comments` to get all comments
2. Parse the JSON response in TypeScript (do NOT use jq)
3. Filter for bot comments where `author.login` is `whitesmith[bot]` or `github-actions[bot]`
4. Count how many match the clarification pattern (body starts with "🤔 I've analyzed this issue")

If `count >= MAX_AMBIGUITY_CYCLES - 1` (about to hit the limit), escalate instead of posting another clarification.

### New interface method: `listComments`

Add `listComments(number: number): Promise<Array<{author: string; body: string}>>` to the `IssueProvider` interface in `src/providers/issue-provider.ts`. This requires:
- Adding the method to the interface definition
- Implementing it in `GitHubProvider` in `src/providers/github.ts`
- **Adding a mock implementation** in `createMockIssueProvider()` in `test/orchestrator.test.ts` (return empty array by default)

### New label

Add `NEEDS_HUMAN_REVIEW: 'whitesmith:needs-human-review'` to `LABELS` in `src/types.ts`.

### Config field

Add an **optional** `maxAmbiguityCycles` field to `DevPulseConfig` in `src/types.ts` with a default of 3:
```typescript
/** Maximum ambiguity cycles before escalating to human review (default: 3) */
maxAmbiguityCycles?: number;
```

Update the `createConfig` test helper in `test/orchestrator.test.ts` to include `maxAmbiguityCycles: 3` as a default.

### Escalation comment template

Add `buildEscalationComment(): string` in `src/prompts.ts`:

```markdown
⚠️ This issue has gone through multiple clarification cycles without reaching a clear task breakdown.

**Human review is needed.** Please:
1. Review the issue description and previous clarification attempts
2. Either update the issue with more detail or break it down manually
3. Remove the `whitesmith:needs-human-review` and `whitesmith:needs-clarification` labels when ready for the agent to retry

_This issue will not be auto-investigated until the labels are removed._
```

### Files to modify

- `src/types.ts` — Add `NEEDS_HUMAN_REVIEW` to `LABELS`. Add optional `maxAmbiguityCycles` to `DevPulseConfig`.
- `src/providers/issue-provider.ts` — Add `listComments` method to the interface.
- `src/providers/github.ts` — Implement `listComments()` using `gh issue view --json comments`, parsing JSON in TypeScript.
- `src/prompts.ts` — Add `buildEscalationComment()`.
- `src/orchestrator.ts` — Add cycle counting logic in `investigate()` before posting clarification comments. Add escalation path. In `decideActionForIssue()`, treat issues with `needs-human-review` label as idle.
- `src/cli.ts` — Add `--max-ambiguity-cycles <n>` option to the `run` command (optional, default 3). Wire it to `DevPulseConfig.maxAmbiguityCycles`.
- `test/orchestrator.test.ts` — Update `createMockIssueProvider()` to include `listComments: vi.fn().mockResolvedValue([])`. Update `createConfig` helper to include `maxAmbiguityCycles: 3`.

## Acceptance Criteria

- After 3 ambiguity cycles (configurable), the system stops auto-investigating
- The `whitesmith:needs-human-review` label is applied to the issue
- A clear escalation comment is posted (from `buildEscalationComment()`)
- Issues with `needs-human-review` label are skipped by `decideActionForIssue()` (returns idle)
- Issues with `needs-human-review` label are automatically excluded from `decideAction()` new-issue scan (via `LABELS` inclusion)
- The threshold is configurable via `--max-ambiguity-cycles` CLI option (defaults to 3)
- Removing both `needs-human-review` and `needs-clarification` labels allows re-investigation
- The `needs-human-review` label is included in `ensureLabels()` (automatic via `LABELS`)
- `listComments` is added to `IssueProvider` interface and implemented in `GitHubProvider`
- The mock `IssueProvider` in tests includes `listComments`
- Unit tests cover: cycle counting, escalation at threshold, skip logic for labeled issues
- The cycle count is based on bot clarification comments matching the pattern, not all comments

## Implementation Notes

- The `listComments` method should use `gh issue view <number> --json comments` and parse the JSON response in TypeScript. The response shape is `{comments: [{author: {login: string}, body: string}]}`. Map this to `{author: string, body: string}[]`.
- For issues with many comments, fetching all comments could be expensive, but for the scope of this feature (≤3 cycles = ≤3 bot comments), this is acceptable. Note this trade-off in a code comment.
- The clarification comment pattern matching should be simple — check if `body.startsWith('🤔 I\'ve analyzed this issue')`.
- The bot username might be `github-actions[bot]` in CI and `whitesmith[bot]` if a GitHub App is used — filter for both.
- The cycle check should happen in `investigate()` BEFORE posting the clarification comment, not after. The flow is: detect ambiguity → count existing cycles → if at limit, escalate instead of posting another clarification.
- `maxAmbiguityCycles` should default to 3 in the orchestrator: `const maxCycles = this.config.maxAmbiguityCycles ?? 3;`
- The `createConfig` helper update is needed because adding `maxAmbiguityCycles` as optional doesn't break existing tests, but having a default in the helper makes tests more explicit.
