---
id: "41-005"
issue: 41
title: "Add reply-based fallback trigger for ambiguous issues"
depends_on: ["41-002"]
---

## Description

Add support for users to reply to the ambiguity comment as an alternative to editing the issue. When a user (not bot) replies to an issue that has the `whitesmith:needs-clarification` label, the existing `whitesmith-comment.yml` workflow should detect this and trigger a re-investigation.

### Workflow changes

Update `.github/workflows/whitesmith-comment.yml` to also trigger for issues (not just PRs and `/whitesmith` commands):

Add a check in the `check` job: if the comment is on an issue (not a PR) that has the `whitesmith:needs-clarification` label, and the commenter is not a bot, set `should_run=true`.

However, instead of running `whitesmith comment`, it should run `whitesmith run --issue <number>` to re-investigate. This requires either:

**Option A:** A separate job in the workflow that detects the `needs-clarification` case and runs `whitesmith run --issue` instead of `whitesmith comment`.

**Option B:** A new workflow `whitesmith-issue-reply.yml` that triggers on `issue_comment.created` for issues with the `needs-clarification` label.

**Recommended: Option A** — extend the existing comment workflow with a conditional second job.

### Comment context

When triggered by a reply, the orchestrator should include the user's reply in the investigation context. Modify `buildInvestigatePrompt` to accept an optional `clarification` parameter:

```typescript
buildInvestigatePrompt(issue: Issue, issueTasksDir: string, options?: {
  clarification?: string;  // User's reply text
})
```

This keeps context minimal — only the issue body + the latest clarification, not the entire comment thread.

### Workflow logic

```
issue_comment.created
  → Is it on an issue (not PR)? 
  → Does issue have needs-clarification label?
  → Is commenter NOT a bot?
  → Remove needs-clarification label
  → Run: whitesmith run --issue <number>
```

## Acceptance Criteria

- User can reply to an ambiguity comment to trigger re-investigation.
- The workflow correctly distinguishes issue comments from PR comments.
- Bot comments do not trigger re-investigation (prevents infinite loops).
- The `needs-clarification` label is removed before re-investigation.
- The user's reply text is available to the investigation prompt (via issue body edit or as additional context).
- Concurrency group prevents parallel runs for the same issue.
- The existing `/whitesmith` comment trigger and PR comment trigger still work as before.

## Implementation Notes

- The `whitesmith-comment.yml` workflow already has a `check` job that inspects comments. Extend it with an additional condition for `needs-clarification` issues.
- For reply-based context: the simplest approach is to NOT pass the reply text to the agent and instead rely on the user editing the issue body. The reply-based trigger simply re-runs investigation on the current issue body. This avoids growing context.
- If we want to pass reply context, add `--clarification-file` option to the `run` command that passes a file with additional context to `buildInvestigatePrompt`.
- Consider adding a reaction (👀) to the user's comment when processing starts, similar to the existing comment workflow.
- Files to modify: `.github/workflows/whitesmith-comment.yml` (or create `.github/workflows/whitesmith-issue-reply.yml`).
- Optionally modify: `src/prompts.ts`, `src/cli.ts` if passing clarification context.
