import type { Issue, Task } from './types.js';

/**
 * Build the prompt for the "investigate" phase.
 * The agent reads the issue, understands the codebase, and generates task files.
 */
export function buildInvestigatePrompt(issue: Issue, issueTasksDir: string): string {
	return `# Task: Generate implementation tasks for Issue #${issue.number}

## Issue
**Title:** ${issue.title}
**URL:** ${issue.url}

### Description
${issue.body}

## Your Job

You are an AI assistant helping break down a GitHub issue into concrete implementation tasks.

1. **Read and understand** the issue above.
2. **Explore the codebase** to understand the architecture, conventions, and relevant code.
3. **Break the issue down** into 1 or more tasks. Each task should represent a single, reviewable PR's worth of work.
4. **Write task files** to the \`${issueTasksDir}\` directory.

## Task File Format

Each task file should be named \`<seq>-<short-slug>.md\` (e.g., \`001-add-validation.md\`) and contain:

\`\`\`markdown
---
id: "${issue.number}-<seq>"
issue: ${issue.number}
title: "<concise title>"
depends_on: []
---

## Description
<detailed description of what needs to be done>

## Acceptance Criteria
- <criterion 1>
- <criterion 2>

## Implementation Notes
<any relevant notes about approach, files to modify, etc.>
\`\`\`

## Rules

- Sequence numbers start at 001 and increment.
- The \`id\` field must be \`"${issue.number}-<seq>"\` (e.g., "${issue.number}-001").
- Use \`depends_on\` to list task IDs that must be completed before this task. For example, if task 002 depends on task 001, set \`depends_on: ["${issue.number}-001"]\`.
- Each task should be a meaningful, self-contained unit of work that results in one PR.
- Be specific in descriptions and acceptance criteria — another AI agent will implement these.
- Consider the existing codebase patterns and conventions.
- Create the \`${issueTasksDir}\` directory if it doesn't exist.

## When Done

After creating all task files, commit your changes:
\`\`\`
git add tasks/
git commit -m "tasks(#${issue.number}): generate implementation tasks"
\`\`\`

Do NOT push. Do NOT create a PR. The orchestrator will handle that.
`;
}

/**
 * Build the prompt for the "implement" phase.
 * The agent implements a specific task and deletes the task file.
 */
export function buildImplementPrompt(task: Task, issue: Issue): string {
	return `# Task: Implement "${task.title}"

## Context

You are implementing a task generated from GitHub Issue #${issue.number}: "${issue.title}"

**Issue URL:** ${issue.url}
**Task ID:** ${task.id}
**Task File:** ${task.filePath}

## Task Details

${task.content}

## Your Job

1. **Read the task** above carefully.
2. **Explore the codebase** to understand the architecture and conventions.
3. **Implement the changes** described in the task.
4. **Verify** your implementation meets the acceptance criteria.
5. **Delete the task file** at \`${task.filePath}\` — this marks the task as complete.
6. **Clean up**: if the task directory \`tasks/${task.issue}/\` is now empty, delete it too.
7. **Commit** all changes (implementation + task file deletion):

\`\`\`
git add -A
git commit -m "feat(#${issue.number}): ${task.title}"
\`\`\`

## Rules

- Follow existing code conventions and patterns.
- Make clean, reviewable changes.
- Do NOT push. Do NOT create a PR. The orchestrator will handle that.
- Do NOT modify other task files.
- You MUST delete \`${task.filePath}\` as part of your commit.
- If the \`tasks/${task.issue}/\` directory is empty after deletion, remove it.
`;
}
