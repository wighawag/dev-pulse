---
id: "15-001"
issue: 15
title: "Add auto-work configuration option and issue-body detection"
depends_on: []
---

## Description

Add the ability to detect "auto-work" mode, which tells whitesmith to skip the task-proposal PR and instead generate tasks then immediately implement them. This task covers:

1. A new `autoWork` enum field on `DevPulseConfig` (global CLI flag) with values: `never`, `always`, `triggered`, `ai`.
2. A `--auto-work <mode>` CLI option on the `run` command (default: `triggered`).
3. A helper function that determines whether an issue should use auto-work mode based on the configured mode and the issue body.
4. Support for both issue body markers **and** issue labels as triggers.

The modes are:
- **`never`**: Auto-work is disabled; always create a task-proposal PR.
- **`always`**: Auto-work is enabled for all issues; never create a task-proposal PR.
- **`triggered`** (default): Auto-work is enabled only when the issue body contains the trigger string `[whitesmith:auto-work]` (case-insensitive) **or** the issue has the label `whitesmith:auto-work`.
- **`ai`**: Auto-work is enabled when the trigger string/label is present OR when the AI determines from the issue content that it should work directly. Uses the model configured via `--auto-work-model` (or falls back to the main model).

## Acceptance Criteria

- `DevPulseConfig` in `src/types.ts` has an `autoWork: AutoWorkMode` field (defaults to `'triggered'`).
- A new `AutoWorkMode` type is exported from `src/types.ts`: `'never' | 'always' | 'triggered' | 'ai'`.
- `whitesmith run --help` shows the `--auto-work <mode>` option with description.
- `--auto-work <mode>` sets `config.autoWork` to the given mode.
- `--auto-work-model <model>` sets the model to use for `ai` mode decisions (optional, falls back to main model).
- A new exported function `isAutoWork(config: DevPulseConfig, issue: Issue, aiDecider?: (issue: Issue) => Promise<boolean>): Promise<boolean>` returns `true` when:
  - `config.autoWork` is `'always'`, OR
  - `config.autoWork` is `'triggered'` and the issue body contains `[whitesmith:auto-work]` (case-insensitive) or the issue has the `whitesmith:auto-work` label, OR
  - `config.autoWork` is `'ai'` and (the trigger string/label is present OR the `aiDecider` callback returns `true`).
- Returns `false` when `config.autoWork` is `'never'`.
- An `aiDecider` implementation is provided that sends a lightweight prompt to the AI.
- Unit tests cover all four modes and their trigger paths (body marker, label, AI decision).
- No orchestrator behavior changes yet — that is task 15-002.

## Implementation Notes

### 1. `src/types.ts`

Add new type and update `DevPulseConfig`:

```ts
/** Auto-work mode controls when whitesmith skips the task-proposal PR */
export type AutoWorkMode = 'never' | 'always' | 'triggered' | 'ai';
```

Add to `DevPulseConfig` (which currently has fields like `agentCmd`, `provider`, `model`, `maxIterations`, `workDir`, `noPush`, `noSleep`, `dryRun`, `logFile`, `repo`):

```ts
/** Auto-work mode: never, always, triggered (default), or ai */
autoWork: AutoWorkMode;
/** Model to use for AI auto-work decisions (optional, falls back to main model) */
autoWorkModel?: string;
```

### 2. `src/cli.ts`

Add to the `run` command options (after existing options like `--dry-run`):

```ts
.option('--auto-work <mode>', 'Auto-work mode: never, always, triggered (default), or ai', 'triggered')
.option('--auto-work-model <model>', 'Model for AI auto-work decisions (defaults to main model)')
```

And in the config construction (inside the `run` action handler):

```ts
autoWork: opts.autoWork ?? 'triggered',
autoWorkModel: opts.autoWorkModel,
```

Validate the value:

```ts
const validModes = ['never', 'always', 'triggered', 'ai'];
if (!validModes.includes(config.autoWork)) {
  console.error(`ERROR: --auto-work must be one of: ${validModes.join(', ')}`);
  process.exit(1);
}
```

### 3. `src/auto-work.ts` (new file)

```ts
import type { DevPulseConfig, Issue } from './types.js';

const AUTO_WORK_MARKER = '[whitesmith:auto-work]';
const AUTO_WORK_LABEL = 'whitesmith:auto-work';

function hasAutoWorkMarker(issue: Issue): boolean {
  return issue.body.toLowerCase().includes(AUTO_WORK_MARKER.toLowerCase());
}

function hasAutoWorkLabel(issue: Issue): boolean {
  return (issue.labels ?? []).some(
    (label) => label.toLowerCase() === AUTO_WORK_LABEL,
  );
}

function isTriggered(issue: Issue): boolean {
  return hasAutoWorkMarker(issue) || hasAutoWorkLabel(issue);
}

export async function isAutoWork(
  config: DevPulseConfig,
  issue: Issue,
  aiDecider?: (issue: Issue) => Promise<boolean>,
): Promise<boolean> {
  switch (config.autoWork) {
    case 'never':
      return false;
    case 'always':
      return true;
    case 'triggered':
      return isTriggered(issue);
    case 'ai':
      if (isTriggered(issue)) return true;
      if (aiDecider) return aiDecider(issue);
      return false;
  }
}
```

### 4. `src/ai-decider.ts` (new file)

Provide a default `aiDecider` implementation:

```ts
import type { Issue } from './types.js';

export function buildAutoWorkDecisionPrompt(issue: Issue): string {
  return `You are a project management assistant. Given the following GitHub issue, determine if it should be directly worked on (auto-work) or if it should go through a task-proposal review process first.

Auto-work is appropriate when:
- The issue is a simple, well-defined task
- The issue is phrased as a direct instruction
- The scope is small and clear

Task-proposal review is appropriate when:
- The issue is complex or ambiguous
- Multiple approaches are possible
- The scope is large or unclear

Issue #${issue.number}: ${issue.title}

${issue.body}

Respond with exactly one word: YES (for auto-work) or NO (for task-proposal review).`;
}
```

The orchestrator (task 15-002) will wire up the actual AI call using `config.autoWorkModel ?? config.model`.

### 5. Tests

Add `test/auto-work.test.ts` that verifies:
- Returns `false` when `config.autoWork` is `'never'` (even with marker in body).
- Returns `true` when `config.autoWork` is `'always'` (even without marker).
- Returns `true` when `config.autoWork` is `'triggered'` and issue body contains `[whitesmith:auto-work]`.
- Returns `true` when `config.autoWork` is `'triggered'` and issue body contains `[WHITESMITH:AUTO-WORK]` (case-insensitive).
- Returns `true` when `config.autoWork` is `'triggered'` and issue has the `whitesmith:auto-work` label.
- Returns `false` when `config.autoWork` is `'triggered'` and issue body does NOT contain the marker and has no label.
- Returns `true` when `config.autoWork` is `'ai'` and issue body contains the marker (fast path).
- Returns `true` when `config.autoWork` is `'ai'` and issue has the label (fast path).
- Returns `true` when `config.autoWork` is `'ai'`, no marker/label, and `aiDecider` returns `true`.
- Returns `false` when `config.autoWork` is `'ai'`, no marker/label, and `aiDecider` returns `false`.
- Returns `false` when `config.autoWork` is `'ai'`, no marker/label, and no `aiDecider` provided.
