---
id: "15-002"
issue: 15
title: "Implement auto-work flow in the orchestrator"
depends_on: ["15-001"]
---

## Description

Modify the orchestrator so that when an issue is detected as "auto-work" (via global flag, issue body marker, or label), it skips the task-proposal PR entirely and instead:

1. Generates tasks (investigate phase) locally.
2. Commits the task files as the **first commit** on the `issue/<number>` branch.
3. Immediately implements each task on that same branch (accumulating commits).
4. Creates a single implementation PR when all tasks are complete — never a task-proposal PR.

This builds on the existing `issue/<number>` branch pattern already used by the `implement()` method in `src/orchestrator.ts`. Currently, the orchestrator's `investigate()` method creates an `investigate/<number>` branch with task files, opens a task-proposal PR, and labels the issue `tasks-proposed`. Only after the PR is merged and tasks land on `main` does the `implement()` method pick them up. Auto-work bypasses this by generating tasks and implementing them in a single flow.

### Error Recovery

The existing orchestrator infrastructure handles crash recovery naturally:

1. **During task generation** — `investigating` label present, no branch pushed. Label is cleaned up; issue picked up again on next run.
2. **After task commit, before implementation** — `tasks-accepted` label, `issue/<N>` branch with task files. `findAvailableTask()` finds tasks available via the branch, `implement()` picks them up normally.
3. **After task K of N implemented** — `tasks-accepted` label, `issue/<N>` branch with K commits. `findAvailableTask()` uses `remoteFileExists()` to check which task files have been deleted (= completed) on the branch, picks up task K+1.
4. **After all tasks but before PR creation** — `tasks-accepted` label, `issue/<N>` branch fully done. `allTasksCompletedOnBranch()` returns true → `reconcile()` safety net creates the PR.

No auto-work-specific recovery code is needed because the existing `findAvailableTask()`, `implement()`, and `reconcile()` methods already handle all these cases.

## Acceptance Criteria

- When `isAutoWork()` returns `true` for an issue in the `investigate` action, the orchestrator does NOT create a task-proposal PR.
- Instead, it generates tasks, commits them to `issue/<number>`, then implements each task on the same branch.
- Branch uses `issue/<number>` naming (same as normal implementation).
- Task files committed as first commit (for visibility and task-completion detection).
- Each task implementation adds one commit (accumulated on the same branch).
- Branch is NOT pushed without the task file commit.
- When all tasks complete, a PR is created immediately.
- The issue is labeled `whitesmith:tasks-accepted` (skipping `tasks-proposed`).
- If task generation fails, labels are cleaned up and no PR is created.
- If auto-work is interrupted mid-way, the normal `findAvailableTask()` + `implement()` flow resumes remaining tasks on subsequent runs.
- The `reconcile()` safety net creates a PR if all tasks are done but no PR exists (crash during PR creation).
- Existing non-auto-work behavior is completely unchanged.
- Integration or unit tests verify the auto-work flow (mocked agent/provider).

## Implementation Notes

### Approach

Add a new method `autoWork(issue: Issue)` to the `Orchestrator` class in `src/orchestrator.ts`. Modify the `run()` loop so that when the action is `investigate` and `isAutoWork()` returns true, it calls `autoWork()` instead of `investigate()`.

### Changes to `src/orchestrator.ts`

1. **Import** `isAutoWork` from `./auto-work.js` and `buildAutoWorkDecisionPrompt` from `./ai-decider.js`.

2. **Create an `aiDecider` callback** that uses the agent harness:

```ts
private aiDecider = async (issue: Issue): Promise<boolean> => {
  const prompt = buildAutoWorkDecisionPrompt(issue);
  const { exitCode, stdout } = await this.agent.run({
    prompt,
    workDir: this.config.workDir,
    logFile: this.config.logFile,
  });
  if (exitCode !== 0) return false;
  return stdout.trim().toUpperCase().startsWith('YES');
};
```

3. **Modify `run()` loop** — in the `switch (action.type)` block, when the action is `investigate`, check `await isAutoWork(this.config, action.issue, this.aiDecider)`. If true, call `this.autoWork(action.issue)` instead of `this.investigate(action.issue)`.

4. **New method `autoWork(issue: Issue)`**:

```ts
private async autoWork(issue: Issue): Promise<void> {
  console.log(`Auto-working issue #${issue.number}: ${issue.title}`);

  // Label as investigating during task generation
  await this.issues.addLabel(issue.number, LABELS.INVESTIGATING);

  const branch = `issue/${issue.number}`;
  const issueTasksDir = `tasks/${issue.number}`;

  // Generate tasks on a temporary branch (not pushed)
  const tempBranch = `autowork-tmp/${issue.number}`;
  await this.git.deleteLocalBranch(tempBranch);
  await this.git.checkout(tempBranch, { create: true, startPoint: 'origin/main' });

  const prompt = buildInvestigatePrompt(issue, issueTasksDir);
  const { exitCode } = await this.agent.run({
    prompt,
    workDir: this.config.workDir,
    logFile: this.config.logFile,
  });

  if (exitCode !== 0) {
    console.error(`Task generation failed with exit code ${exitCode}`);
    await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
    await this.git.checkoutMain();
    return;
  }

  // Verify tasks were created
  const tasks = this.tasks.listTasks(issue.number);
  if (tasks.length === 0) {
    console.error('Agent did not create any task files');
    await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
    await this.git.checkoutMain();
    return;
  }

  // Read task file contents before switching branches
  const taskFileContents = tasks.map(t => ({
    filePath: t.filePath,
    content: fs.readFileSync(path.join(this.config.workDir, t.filePath), 'utf-8'),
  }));

  // Set up the issue branch (reuse if it exists from a previous partial run)
  await this.git.deleteLocalBranch(branch);

  const remoteBranchExists = await this.issues.remoteBranchExists(branch);
  if (remoteBranchExists) {
    await this.git.checkout(branch, { create: true, startPoint: `origin/${branch}` });
  } else {
    await this.git.checkout(branch, { create: true, startPoint: 'origin/main' });
  }

  // Write task files as the first commit on the issue branch
  for (const { filePath, content } of taskFileContents) {
    const fullPath = path.join(this.config.workDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  await this.git.commitAll(`tasks(#${issue.number}): generate implementation tasks`);

  if (!this.config.noPush) {
    await this.git.forcePush(branch);
  }

  // Transition labels: skip tasks-proposed, go directly to tasks-accepted
  await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
  await this.issues.addLabel(issue.number, LABELS.TASKS_ACCEPTED);

  console.log(`Generated ${tasks.length} task(s), proceeding to implement`);

  // Implement each task in dependency order on the same branch
  for (const task of tasks) {
    console.log(`Implementing task ${task.id}: ${task.title}`);

    const implementPrompt = buildImplementPrompt(task, issue);
    const result = await this.agent.run({
      prompt: implementPrompt,
      workDir: this.config.workDir,
      logFile: this.config.logFile,
    });

    if (result.exitCode !== 0) {
      console.error(`Agent failed on task ${task.id} with exit code ${result.exitCode}`);
      // Push what we have so far — the normal flow will resume later
      if (!this.config.noPush) {
        await this.git.forcePush(branch);
      }
      await this.git.checkoutMain();
      return;
    }

    await this.git.commitAll(`feat(#${issue.number}): ${task.title}`);

    if (!this.config.noPush) {
      await this.git.forcePush(branch);
    }
  }

  // All tasks done — create PR
  if (!this.config.noPush) {
    const remainingTasks = this.tasks.listTasks(issue.number);
    if (remainingTasks.length === 0) {
      const existingPR = await this.issues.getPRForBranch(branch);
      let prUrl: string;

      if (existingPR && existingPR.state === 'open') {
        prUrl = existingPR.url;
        console.log(`PR already exists: ${prUrl}`);
      } else {
        prUrl = await this.issues.createPR({
          head: branch,
          base: 'main',
          title: `feat(#${issue.number}): ${issue.title}`,
          body: `## Implementation for #${issue.number}\n\nAll tasks completed.\n\n---\n*Implemented by whitesmith (auto-work)*\n\nCloses #${issue.number}`,
        });
      }
      console.log(`PR created: ${prUrl}`);
    }
  }

  // Clean up
  await this.git.checkoutMain();
  await this.git.deleteLocalBranch(tempBranch);
}
```

### Commit structure on the `issue/<number>` branch

This matches the existing pattern used by `implement()`:

- Commit 1: `tasks(#N): generate implementation tasks` — task files added
- Commit 2: `feat(#N): <task 1 title>` — implementation + task file deletion
- Commit 3: `feat(#N): <task 2 title>` — implementation + task file deletion
- ...

### Label flow

```
(no labels) → whitesmith:investigating → whitesmith:tasks-accepted → (normal reconcile flow)
```

Note: `whitesmith:tasks-proposed` is **skipped entirely** for auto-work issues.

### Race condition mitigation

The `INVESTIGATING` label (defined in `src/types.ts` as `LABELS.INVESTIGATING`) serves as a mutex during the task generation phase. Once the label transitions to `tasks-accepted`, auto-work enters the implementation loop on the `issue/<number>` branch. If another orchestrator instance runs concurrently, `findAvailableTask()` will find the same issue and tasks — but since both would operate on the same `issue/<number>` branch, the force-push behavior means one instance's work overwrites the other's. This is the same behavior as for normal `implement()` and is acceptable for the current design.

### Files to modify

- `src/orchestrator.ts` — add `autoWork()` method, modify `run()` to detect auto-work on `investigate` action, add `aiDecider` callback
- `test/orchestrator.test.ts` — add tests for the auto-work flow

### Tests

Add tests that verify:
- Auto-work skips task-proposal PR and goes directly to implementation.
- Task files are committed as the first commit on `issue/<number>` branch.
- All tasks implemented sequentially with accumulated commits.
- PR created when all tasks complete.
- Label transitions: `investigating` → `tasks-accepted` (no `tasks-proposed`).
- Crash recovery: partial auto-work resumes via normal `findAvailableTask()` + `implement()`.
- `noPush` mode works correctly.
- Non-auto-work behavior is unchanged.
- `ai` mode uses `autoWorkModel` when configured.
