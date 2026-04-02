/**
 * Integration test for whitesmith.
 *
 * This test creates a real GitHub issue on the current repo, clones the repo
 * into a temporary directory, runs whitesmith with a mock agent, and verifies:
 * - The investigate phase creates a branch and PR with tasks
 * - Labels are applied correctly
 * - Retrying is handled gracefully (force-push, existing PR reuse)
 *
 * Prerequisites:
 * - `gh` CLI authenticated with access to the repo
 * - Running in a git repo with push access
 *
 * Run with: INTEGRATION=1 pnpm test -- test/integration.test.ts
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest';
import {exec} from 'node:child_process';
import {promisify} from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {Orchestrator} from '../src/orchestrator.js';
import {GitHubProvider} from '../src/providers/github.js';
import {LABELS} from '../src/types.js';
import type {DevPulseConfig} from '../src/types.js';
import type {AgentHarness} from '../src/harnesses/agent-harness.js';

const execAsync = promisify(exec);

// Only run if INTEGRATION env var is set
const runIntegration = process.env.INTEGRATION === '1';

/**
 * A mock agent that creates task files without AI.
 */
class MockAgent implements AgentHarness {
	async validate(): Promise<void> {}

	async run(options: {
		prompt: string;
		workDir: string;
		logFile?: string;
	}): Promise<{output: string; exitCode: number}> {
		const match = options.prompt.match(/Issue #(\d+)/);
		if (!match) {
			return {output: 'Could not find issue number in prompt', exitCode: 1};
		}
		const issueNumber = match[1];
		const isInvestigate = options.prompt.includes('Generate implementation tasks');

		if (isInvestigate) {
			const tasksDir = path.join(options.workDir, 'tasks', issueNumber);
			fs.mkdirSync(tasksDir, {recursive: true});

			fs.writeFileSync(
				path.join(tasksDir, '001-test-task.md'),
				`---
id: "${issueNumber}-001"
issue: ${issueNumber}
title: "Test task for integration test"
depends_on: []
---

## Description
Test task created by integration test mock agent.

## Acceptance Criteria
- The task file exists
- The PR is created
`,
			);

			await execAsync(`git add tasks/`, {cwd: options.workDir});
			await execAsync(
				`git commit -m "tasks(#${issueNumber}): generate implementation tasks"`,
				{cwd: options.workDir},
			);
			return {output: 'Created task files', exitCode: 0};
		}

		return {output: 'Not an investigate prompt', exitCode: 1};
	}
}

describe.skipIf(!runIntegration)('Integration', () => {
	let tmpCloneDir: string;
	let repo: string;
	let createdIssueNumber: number;
	let createdBranches: string[] = [];
	let createdPRNumbers: number[] = [];
	/** Issues that we temporarily labeled to exclude from the orchestrator */
	let temporarilyLabeledIssues: number[] = [];

	beforeAll(async () => {
		// Detect repo from source dir
		const sourceDir = path.resolve(__dirname, '..');
		const remoteUrl = (await execAsync('git remote get-url origin', {cwd: sourceDir})).stdout.trim();
		const repoMatch = remoteUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
		if (!repoMatch) throw new Error(`Could not parse repo from remote URL: ${remoteUrl}`);
		repo = repoMatch[1];

		console.log(`Integration test using repo: ${repo}`);

		// Verify gh is authenticated
		await execAsync(`gh auth status`);

		// Clone repo to temp dir
		const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'whitesmith-integration-'));
		await execAsync(`git clone ${remoteUrl} repo`, {cwd: tmpBase});
		tmpCloneDir = path.join(tmpBase, 'repo');
		await execAsync(`git config user.name "whitesmith-test"`, {cwd: tmpCloneDir});
		await execAsync(`git config user.email "test@whitesmith.local"`, {cwd: tmpCloneDir});

		console.log(`Working directory: ${tmpCloneDir}`);

		// Temporarily label any existing unlabeled issues so the orchestrator
		// only picks up our test issue
		const issues = new GitHubProvider(tmpCloneDir, repo);
		const allLabels = Object.values(LABELS);
		const unlabeledIssues = await issues.listIssues({noLabels: allLabels});
		for (const issue of unlabeledIssues) {
			console.log(`Temporarily labeling issue #${issue.number} to exclude it`);
			await issues.addLabel(issue.number, LABELS.INVESTIGATING);
			temporarilyLabeledIssues.push(issue.number);
		}
	}, 60_000);

	afterAll(async () => {
		const issues = new GitHubProvider(tmpCloneDir, repo);
		const cleanupErrors: string[] = [];

		// Close PRs we created
		for (const prNum of createdPRNumbers) {
			try {
				await execAsync(`gh pr close ${prNum} --delete-branch --repo ${repo}`, {cwd: tmpCloneDir});
			} catch (e: any) {
				cleanupErrors.push(`Failed to close PR #${prNum}: ${e.message}`);
			}
		}

		// Close our test issue
		if (createdIssueNumber) {
			try {
				// Remove any whitesmith labels first
				for (const label of Object.values(LABELS)) {
					try {
						await issues.removeLabel(createdIssueNumber, label);
					} catch {}
				}
				await execAsync(`gh issue close ${createdIssueNumber} --repo ${repo}`, {cwd: tmpCloneDir});
			} catch (e: any) {
				cleanupErrors.push(`Failed to close issue #${createdIssueNumber}: ${e.message}`);
			}
		}

		// Delete any leftover remote branches
		for (const branch of createdBranches) {
			try {
				await execAsync(`git push origin --delete ${branch}`, {cwd: tmpCloneDir});
			} catch {}
		}

		// Restore temporarily labeled issues
		for (const issueNum of temporarilyLabeledIssues) {
			try {
				await issues.removeLabel(issueNum, LABELS.INVESTIGATING);
			} catch (e: any) {
				cleanupErrors.push(`Failed to restore issue #${issueNum}: ${e.message}`);
			}
		}

		// Clean up temp dir
		try {
			fs.rmSync(path.dirname(tmpCloneDir), {recursive: true, force: true});
		} catch {}

		if (cleanupErrors.length > 0) {
			console.warn('Cleanup warnings:', cleanupErrors);
		}
	}, 30_000);

	it('investigate: creates issue → runs whitesmith → gets PR with tasks', async () => {
		const issueTitle = `[integration-test] ${Date.now()}`;
		const issueBody = 'Automated integration test issue. Will be cleaned up.';

		// 1. Create test issue
		const createOutput = await execAsync(
			`gh issue create --title "${issueTitle}" --body "${issueBody}" --repo ${repo}`,
			{cwd: tmpCloneDir},
		);
		const issueUrl = createOutput.stdout.trim();
		createdIssueNumber = parseInt(issueUrl.match(/\/issues\/(\d+)$/)![1], 10);
		console.log(`Created issue #${createdIssueNumber}: ${issueUrl}`);

		// 2. Run whitesmith
		const config: DevPulseConfig = {
			agentCmd: 'mock',
			provider: 'mock',
			model: 'mock',
			maxIterations: 1,
			workDir: tmpCloneDir,
			noPush: false,
			noSleep: true,
			repo,
		};

		const issues = new GitHubProvider(tmpCloneDir, repo);
		const orchestrator = new Orchestrator(config, issues, new MockAgent());
		await orchestrator.run();

		// 3. Verify branch exists
		const branch = `investigate/${createdIssueNumber}`;
		createdBranches.push(branch);
		expect(await issues.remoteBranchExists(branch)).toBe(true);

		// 4. Verify PR was created
		const pr = await issues.getPRForBranch(branch);
		expect(pr).toBeTruthy();
		expect(pr!.state).toBe('open');

		const prNum = parseInt(pr!.url.match(/\/pull\/(\d+)$/)![1], 10);
		createdPRNumbers.push(prNum);

		// 5. Verify issue labels
		const issue = await issues.getIssue(createdIssueNumber);
		expect(issue.labels).toContain(LABELS.TASKS_PROPOSED);
		expect(issue.labels).not.toContain(LABELS.INVESTIGATING);

		// 6. Verify PR has task files
		const prFiles = await execAsync(
			`gh pr view ${prNum} --json files --jq '.files[].path' --repo ${repo}`,
			{cwd: tmpCloneDir},
		);
		const filePaths = prFiles.stdout.trim().split('\n');
		expect(filePaths.some((f) => f.startsWith(`tasks/${createdIssueNumber}/`))).toBe(true);

		console.log(`✅ PR #${prNum} created with task files: ${pr!.url}`);
	}, 120_000);

	it('investigate retry: force-pushes and reuses existing PR', async () => {
		if (!createdIssueNumber) return;

		// Remove the tasks-proposed label so the orchestrator picks it up again
		const issues = new GitHubProvider(tmpCloneDir, repo);
		await issues.removeLabel(createdIssueNumber, LABELS.TASKS_PROPOSED);

		// Make sure we're on main and have the latest
		await execAsync(`git checkout main && git pull origin main`, {cwd: tmpCloneDir});

		const config: DevPulseConfig = {
			agentCmd: 'mock',
			provider: 'mock',
			model: 'mock',
			maxIterations: 1,
			workDir: tmpCloneDir,
			noPush: false,
			noSleep: true,
			repo,
		};

		const orchestrator = new Orchestrator(config, issues, new MockAgent());

		// Should NOT throw — force push handles the existing branch,
		// and getPRForBranch finds the existing PR
		await orchestrator.run();

		// Verify issue still gets labeled properly
		const issue = await issues.getIssue(createdIssueNumber);
		expect(issue.labels).toContain(LABELS.TASKS_PROPOSED);

		console.log('✅ Retry handled gracefully');
	}, 120_000);
});
