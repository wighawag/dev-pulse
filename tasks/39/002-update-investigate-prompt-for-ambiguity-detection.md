---
id: "39-002"
issue: 39
title: "Update investigate prompt to detect ambiguity and report readiness"
depends_on: ["39-001"]
---

## Description

Modify the `buildInvestigatePrompt` function in `src/prompts.ts` to instruct the agent to evaluate issue clarity during investigation. When the agent finds ambiguities or unanswered questions in the issue, it should:

1. Still generate task files (as it does today).
2. Write an additional file (e.g., `.whitesmith-ambiguity.md`) containing:
   - A list of ambiguities or unclear aspects found in the issue
   - Specific questions that need answering before implementation should proceed
   - A boolean/flag indicating whether the issue is clear enough for implementation
3. The file format should be structured so the orchestrator can parse it. Use a simple format:
   ```
   READY: false
   
   ## Ambiguities
   
   - <ambiguity 1>
   - <ambiguity 2>
   
   ## Questions
   
   - <question 1>
   - <question 2>
   ```

The prompt should tell the agent:
- If the issue is completely clear and unambiguous, write `READY: true` and skip the ambiguities/questions sections.
- If there are ambiguities, write `READY: false` followed by the details.
- The agent should still create task files either way — the tasks represent the agent's best understanding even if there are open questions.

## Acceptance Criteria

- `buildInvestigatePrompt` includes instructions for the agent to evaluate issue clarity.
- The prompt specifies the `.whitesmith-ambiguity.md` file format with `READY: true/false` header.
- The prompt tells the agent to always create task files regardless of ambiguity.
- The prompt tells the agent to list specific ambiguities and questions when `READY: false`.
- A new function `parseAmbiguityReport(content: string): { ready: boolean; ambiguities: string[]; questions: string[] }` is added to parse the ambiguity file.
- Unit tests verify the prompt includes ambiguity detection instructions.
- Unit tests verify `parseAmbiguityReport` correctly parses both ready and not-ready reports.

## Implementation Notes

- Modify `src/prompts.ts`: update `buildInvestigatePrompt` to add an "Ambiguity Assessment" section.
- Add `parseAmbiguityReport` function to `src/prompts.ts` or `src/readiness.ts`.
- Update `test/prompts.test.ts` to verify the new prompt content.
- The ambiguity report file name (`.whitesmith-ambiguity.md`) should be a constant, not hardcoded in multiple places.
