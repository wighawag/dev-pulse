import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Orchestrator } from '../src/orchestrator.js';
import { TaskManager } from '../src/task-manager.js';
import { LABELS } from '../src/types.js';
import type { Issue, DevPulseConfig, Task } from '../src/types.js';
import type { IssueProvider } from '../src/providers/issue-provider.js';
import type { AgentHarness } from '../src/harnesses/agent-harness.js';

// --- Helpers ---

function makeIssue(overrides: Partial<Issue> = {}): Issue {
	return {
		number: 1,
		title: 'Test issue',
		body: 'Test body',
		labels: [],
		url: 'https://github.com/test/repo/issues/1',
		...overrides,
	};
}

function createMockIssueProvider(overrides: Partial<IssueProvider> = {}): IssueProvider {
	return {
		listIssues: vi.fn().mockResolvedValue([]),
		getIssue: vi.fn().mockResolvedValue(makeIssue()),
		addLabel: vi.fn().mockResolvedValue(undefined),
		removeLabel: vi.fn().mockResolvedValue(undefined),
		comment: vi.fn().mockResolvedValue(undefined),
		closeIssue: vi.fn().mockResolvedValue(undefined),
		createPR: vi.fn().mockResolvedValue('https://github.com/test/repo/pull/1'),
		remoteBranchExists: vi.fn().mockResolvedValue(false),
		getPRForBranch: vi.fn().mockResolvedValue(null),
		ensureLabels: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

function createMockAgent(overrides: Partial<AgentHarness> = {}): AgentHarness {
	return {
		run: vi.fn().mockResolvedValue({ output: '', exitCode: 0 }),
		...overrides,
	};
}

function createConfig(workDir: string, overrides: Partial<DevPulseConfig> = {}): DevPulseConfig {
	return {
		agentCmd: 'mock-agent',
		maxIterations: 1,
		workDir,
		noPush: true,
		noSleep: true,
		...overrides,
	};
}

function writeTaskFile(tmpDir: string, issueNumber: number, seq: number, slug: string, dependsOn: string[] = []) {
	const dir = path.join(tmpDir, 'tasks', String(issueNumber));
	fs.mkdirSync(dir, { recursive: true });
	const seqStr = String(seq).padStart(3, '0');
	const id = `${issueNumber}-${seqStr}`;
	const depsStr = dependsOn.map(d => `"${d}"`).join(', ');
	fs.writeFileSync(path.join(dir, `${seqStr}-${slug}.md`), `---
id: "${id}"
issue: ${issueNumber}
title: "Task ${slug}"
depends_on: [${depsStr}]
---

## Description
Test task.
`);
	return id;
}

// We need to mock GitManager since tests don't have a real git repo
vi.mock('../src/git.js', () => {
	class MockGitManager {
		fetch = vi.fn().mockResolvedValue(undefined);
		checkoutMain = vi.fn().mockResolvedValue(undefined);
		checkout = vi.fn().mockResolvedValue(undefined);
		getCurrentBranch = vi.fn().mockResolvedValue('main');
		commitAll = vi.fn().mockResolvedValue(false);
		push = vi.fn().mockResolvedValue(undefined);
		forcePush = vi.fn().mockResolvedValue(undefined);
		hasChanges = vi.fn().mockResolvedValue(false);
		localBranchExists = vi.fn().mockResolvedValue(false);
		deleteLocalBranch = vi.fn().mockResolvedValue(undefined);
		getDefaultBranch = vi.fn().mockResolvedValue('main');
		verifyBranch = vi.fn().mockResolvedValue(undefined);
	}
	return { GitManager: MockGitManager };
});

describe('Orchestrator', () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-pulse-orch-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		vi.restoreAllMocks();
	});

	describe('idle when nothing to do', () => {
		it('goes idle when no issues exist', async () => {
			const issues = createMockIssueProvider();
			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			// Agent should not be called
			expect(agent.run).not.toHaveBeenCalled();
		});
	});

	describe('reconcile', () => {
		it('closes an issue when all tasks are done', async () => {
			const issue = makeIssue({ number: 42, title: 'Feature X' });

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [issue];
					return [];
				}),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			// No task files = all tasks completed
			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(issues.addLabel).toHaveBeenCalledWith(42, LABELS.COMPLETED);
			expect(issues.removeLabel).toHaveBeenCalledWith(42, LABELS.TASKS_ACCEPTED);
			expect(issues.closeIssue).toHaveBeenCalledWith(42);
			expect(issues.comment).toHaveBeenCalledWith(42, expect.stringContaining('All tasks'));
		});
	});

	describe('investigate', () => {
		it('runs agent and labels issue when investigating', async () => {
			const issue = makeIssue({ number: 7, title: 'New feature' });

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [];
					if (opts?.noLabels) return [issue];
					return [];
				}),
			});

			// Agent creates task files during its run
			const agent = createMockAgent({
				run: vi.fn().mockImplementation(async () => {
					writeTaskFile(tmpDir, 7, 1, 'first-task');
					return { output: 'done', exitCode: 0 };
				}),
			});

			const config = createConfig(tmpDir);
			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(issues.addLabel).toHaveBeenCalledWith(7, LABELS.INVESTIGATING);
			expect(agent.run).toHaveBeenCalledTimes(1);
			expect(agent.run).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining('Issue #7'),
					workDir: tmpDir,
				})
			);
		});

		it('removes investigating label if agent fails', async () => {
			const issue = makeIssue({ number: 3 });

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [];
					if (opts?.noLabels) return [issue];
					return [];
				}),
			});

			const agent = createMockAgent({
				run: vi.fn().mockResolvedValue({ output: 'error', exitCode: 1 }),
			});

			const config = createConfig(tmpDir);
			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(issues.addLabel).toHaveBeenCalledWith(3, LABELS.INVESTIGATING);
			expect(issues.removeLabel).toHaveBeenCalledWith(3, LABELS.INVESTIGATING);
		});

		it('removes investigating label if agent creates no tasks', async () => {
			const issue = makeIssue({ number: 5 });

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [];
					if (opts?.noLabels) return [issue];
					return [];
				}),
			});

			// Agent succeeds but creates no task files
			const agent = createMockAgent({
				run: vi.fn().mockResolvedValue({ output: 'done', exitCode: 0 }),
			});

			const config = createConfig(tmpDir);
			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(issues.removeLabel).toHaveBeenCalledWith(5, LABELS.INVESTIGATING);
		});
	});

	describe('implement', () => {
		it('runs agent to implement an available task', async () => {
			const issue = makeIssue({ number: 10, title: 'Add logging' });

			writeTaskFile(tmpDir, 10, 1, 'add-logger');

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [issue];
					return [];
				}),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(agent.run).toHaveBeenCalledTimes(1);
			expect(agent.run).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining('10-001'),
					workDir: tmpDir,
				})
			);
		});

		it('skips tasks with unsatisfied dependencies', async () => {
			const issue = makeIssue({ number: 20 });

			writeTaskFile(tmpDir, 20, 1, 'base');
			writeTaskFile(tmpDir, 20, 2, 'dependent', ['20-001']);

			// Make branch exist for task 20-001 so it's skipped
			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [issue];
					return [];
				}),
				remoteBranchExists: vi.fn().mockImplementation(async (branch: string) => {
					return branch === 'task/20-001';
				}),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			// Agent should NOT be called because:
			// - 20-001 has a remote branch (someone working on it)
			// - 20-002 depends on 20-001 which still exists
			expect(agent.run).not.toHaveBeenCalled();
		});

		it('skips tasks that already have a remote branch', async () => {
			const issue = makeIssue({ number: 30 });
			writeTaskFile(tmpDir, 30, 1, 'task-a');

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [issue];
					return [];
				}),
				remoteBranchExists: vi.fn().mockResolvedValue(true),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(agent.run).not.toHaveBeenCalled();
		});
	});

	describe('priority ordering', () => {
		it('reconcile takes priority over implement', async () => {
			const completedIssue = makeIssue({ number: 1, title: 'Done' });
			const activeIssue = makeIssue({ number: 2, title: 'Active' });

			// Issue 2 has tasks, issue 1 doesn't (= all done)
			writeTaskFile(tmpDir, 2, 1, 'pending');

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [completedIssue, activeIssue];
					return [];
				}),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			// Should reconcile (close issue 1) rather than implement
			expect(issues.closeIssue).toHaveBeenCalledWith(1);
			expect(agent.run).not.toHaveBeenCalled();
		});

		it('implement takes priority over investigate', async () => {
			const acceptedIssue = makeIssue({ number: 1, title: 'Has tasks' });
			const newIssue = makeIssue({ number: 2, title: 'New issue' });

			writeTaskFile(tmpDir, 1, 1, 'pending');

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [acceptedIssue];
					if (opts?.noLabels) return [newIssue];
					return [];
				}),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir);

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			// Should implement the task, not investigate the new issue
			expect(agent.run).toHaveBeenCalledWith(
				expect.objectContaining({
					prompt: expect.stringContaining('1-001'),
				})
			);
		});
	});

	describe('push mode', () => {
		it('creates PR when noPush is false during investigate', async () => {
			const issue = makeIssue({ number: 8 });

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [];
					if (opts?.noLabels) return [issue];
					return [];
				}),
			});

			const agent = createMockAgent({
				run: vi.fn().mockImplementation(async () => {
					writeTaskFile(tmpDir, 8, 1, 'the-task');
					return { output: 'done', exitCode: 0 };
				}),
			});

			const config = createConfig(tmpDir, { noPush: false });
			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(issues.createPR).toHaveBeenCalledWith(
				expect.objectContaining({
					head: 'investigate/8',
					base: 'main',
					title: expect.stringContaining('#8'),
				})
			);
			expect(issues.addLabel).toHaveBeenCalledWith(8, LABELS.TASKS_PROPOSED);
		});

		it('creates PR when noPush is false during implement', async () => {
			const issue = makeIssue({ number: 15 });
			writeTaskFile(tmpDir, 15, 1, 'do-thing');

			const issues = createMockIssueProvider({
				listIssues: vi.fn().mockImplementation(async (opts?: { labels?: string[]; noLabels?: string[] }) => {
					if (opts?.labels?.includes(LABELS.TASKS_ACCEPTED)) return [issue];
					return [];
				}),
			});

			const agent = createMockAgent();
			const config = createConfig(tmpDir, { noPush: false });

			const orch = new Orchestrator(config, issues, agent);
			await orch.run();

			expect(issues.createPR).toHaveBeenCalledWith(
				expect.objectContaining({
					head: 'task/15-001',
					base: 'main',
				})
			);
		});
	});
});
