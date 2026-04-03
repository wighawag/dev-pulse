---
id: "26-002"
issue: 26
title: "Implement the 'ai' auto-work mode with LLM-based issue analysis"
depends_on: ["26-001"]
---

## Description

Implement the `ai` auto-work mode that uses an LLM to analyze the issue content and determine whether whitesmith should work on it directly (auto-work) or wait for manual merge. When mode is `ai`, the system first checks the trigger conditions (label/body keyword). If not triggered, it calls the configured model to make the decision.

## Acceptance Criteria

- When `autoWorkMode` is `ai` and trigger conditions are not met, the system calls an LLM to decide
- The LLM call uses `autoWorkModel` if set, otherwise falls back to the main `model` from config
- The prompt sent to the LLM includes the issue title, body, and asks for a yes/no decision on whether to auto-work
- The LLM response is parsed to extract a boolean decision
- `isAutoWorkEnabled()` becomes async (returns `Promise<boolean>`) to support the LLM call
- All callers of `isAutoWorkEnabled()` are updated for the async signature
- Tests cover the `ai` mode: triggered short-circuit, AI says yes, AI says no, AI call failure (defaults to false)

## Implementation Notes

### Approach
- Make `isAutoWorkEnabled()` async in `src/auto-work.ts`
- For the AI call, use the agent harness or create a lightweight LLM call utility. Look at how the codebase already calls models — likely through the agent harness. If no direct model call exists, a simple approach is to use the agent harness with a prompt that asks for a yes/no answer, or shell out to a CLI tool.
- A simpler approach: add a function that runs a quick prompt through the configured provider/model. This could use the agent command (e.g., `pi`) with a simple prompt, or use a direct API call if the codebase supports it.
- The prompt should be something like: "Given this GitHub issue, should an AI agent work on it immediately without human review? Answer YES or NO. Issue: [title] [body]"
- Update `src/orchestrator.ts` `decideAction()` where `isAutoWorkEnabled` is called — add `await`
- Update `test/auto-work.test.ts` with new async test cases, mocking the LLM call

### Files to modify
- `src/auto-work.ts`: Make async, add AI decision logic
- `src/orchestrator.ts`: Await the now-async `isAutoWorkEnabled()`
- `test/auto-work.test.ts`: Add tests for AI mode
- Possibly `src/types.ts` if additional config fields are needed
