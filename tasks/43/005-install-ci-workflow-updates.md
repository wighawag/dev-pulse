---
id: "43-005"
issue: 43
title: "Update install-ci to generate workflows with new triggers and labels"
depends_on: ["43-003", "43-004"]
---

## Description

Update the `install-ci` command's workflow generators in `src/providers/github-ci.ts` to include the new trigger for ambiguous investigations.

### Changes to generated workflows

1. **`generateIssueWorkflow()`** — Update to trigger on both `opened` and `edited` events. Add a condition for the `edited` event to only run when the issue has the `whitesmith:needs-clarification` label:

   ```yaml
   on:
     issues:
       types: [opened, edited]
   
   jobs:
     run:
       if: >-
         github.event.action == 'opened' ||
         (github.event.action == 'edited' && 
          contains(join(github.event.issue.labels.*.name, ','), 'whitesmith:needs-clarification'))
   ```

2. **New labels in setup action** — The `ensureLabels` call already handles this at runtime, but document the new labels in any generated README or comments.

### Files to modify

- `src/providers/github-ci.ts` — Update `generateIssueWorkflow()`.

## Acceptance Criteria

- `install-ci` generates an issue workflow that triggers on both `opened` and `edited`
- The `edited` trigger is filtered to only run for issues with `needs-clarification` label
- Existing workflow generation behavior is preserved for non-ambiguity flows
- The generated workflows pass YAML linting
- No changes to the comment workflow are needed (re-investigation is edit-only)

## Implementation Notes

- The `generateIssueWorkflow()` function uses template strings. Be careful with escaping `${{ }}` expressions — they need to use `\${{ }}` in the template literals.
- Test by running `install-ci --fake` and comparing the generated files.
