---
id: "41-004"
issue: 41
title: "Update existing ambiguity comment instead of creating new ones"
depends_on: ["41-003"]
---

## Description

When the agent re-investigates an issue and it's still ambiguous, update the existing ambiguity comment rather than posting a new one. This prevents comment spam on the issue.

### IssueProvider changes

Add two new methods to the `IssueProvider` interface and implement them in `GitHubProvider`:

1. `findComment(issueNumber: number, pattern: string): Promise<{id: number; body: string} | null>` — Find a comment on an issue that matches a pattern (e.g., contains a specific marker string).
2. `updateComment(commentId: number, body: string): Promise<void>` — Update an existing comment by ID.

### Comment marker

Include a hidden HTML marker in ambiguity comments to make them identifiable:

```markdown
<!-- whitesmith:ambiguity -->
🤔 I've analyzed this issue and need clarification...
```

When re-investigating and finding ambiguity again:
1. Search for existing comment with `<!-- whitesmith:ambiguity -->` marker.
2. If found, update it with the new questions.
3. If not found, create a new comment.

### Ambiguity count in comment

Include the attempt count in the comment:

```markdown
<!-- whitesmith:ambiguity:attempt=2 -->
🤔 I've re-analyzed this issue (attempt 2/3) and still need clarification:
...
```

The orchestrator can parse the attempt number from the existing comment to implement the max-3-attempts logic from task 003.

## Acceptance Criteria

- `IssueProvider` interface has `findComment` and `updateComment` methods.
- `GitHubProvider` implements both methods using `gh` CLI.
- Ambiguity comments include a hidden HTML marker (`<!-- whitesmith:ambiguity -->`).
- On re-investigation with ambiguity, the existing comment is updated instead of creating a new one.
- The attempt count is tracked in the comment marker and displayed to the user.
- When no existing ambiguity comment is found, a new one is created.
- Tests cover: finding existing comment, updating comment, creating new comment when none exists.

## Implementation Notes

- For `findComment`, use `gh issue view <number> --comments --json comments` and search for the pattern. This is the only place we need to load comments, and it's targeted (only when re-investigating an ambiguous issue).
- For `updateComment`, use `gh api repos/{owner}/{repo}/issues/comments/{id} -X PATCH -f body="..."` or `gh issue comment --edit-last` if available.
- The `gh` CLI supports `gh api` for REST API calls: `gh api repos/{owner}/{repo}/issues/comments/{comment_id} -X PATCH --field body=@-`.
- Parse attempt count from marker: `<!-- whitesmith:ambiguity:attempt=(\d+) -->`.
- Files to modify: `src/providers/issue-provider.ts`, `src/providers/github.ts`, `src/orchestrator.ts`.
