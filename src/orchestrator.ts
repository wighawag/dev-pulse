import type {DevPulseConfig, Issue, Task, Action} from './types.js';
import {LABELS} from './types.js';
import type {IssueProvider} from './providers/issue-provider.js';
import type {AgentHarness} from './harnesses/agent-harness.js';
import {TaskManager} from './task-manager.js';
import {GitManager} from './git.js';
import {buildInvestigatePrompt, buildImplementPrompt} from './prompts.js';

/**
 * Main orchestrator for whitesmith.
 *
 * The loop:
 * 1. Reconcile — check if any issues with tasks-accepted have all tasks done
 * 2. Investigate — pick an unlabeled issue, generate tasks
 * 3. Implement — pick an available task, implement it
 */
export class Orchestrator {
	private config: DevPulseConfig;
	private issues: IssueProvider;
	private agent: AgentHarness;
	private tasks: TaskManager;
	private git: GitManager;

	constructor(config: DevPulseConfig, issues: IssueProvider, agent: AgentHarness) {
		this.config = config;
		this.issues = issues;
		this.agent = agent;
		this.tasks = new TaskManager(config.workDir);
		this.git = new GitManager(config.workDir);
	}

	/**
	 * Run the main loop
	 */
	async run(): Promise<void> {
		console.log('=== whitesmith ===');
		console.log(`Working directory: ${this.config.workDir}`);
		console.log(`Max iterations: ${this.config.maxIterations}`);
		console.log(`Agent command: ${this.config.agentCmd}`);
		console.log(`Provider: ${this.config.provider}`);
		console.log(`Model: ${this.config.model}`);
		console.log('');

		// Validate agent is available before doing anything
		await this.agent.validate();
		console.log('Agent validated successfully.');
		console.log('');

		// Ensure labels exist
		await this.issues.ensureLabels(Object.values(LABELS));

		for (let i = 1; i <= this.config.maxIterations; i++) {
			console.log('');
			console.log(`=== Iteration ${i}/${this.config.maxIterations} ===`);

			// Make sure we're on main with latest
			await this.git.fetch();
			await this.git.checkoutMain();

			// Decide what to do
			const action = await this.decideAction();
			console.log(`Action: ${action.type}`);

			switch (action.type) {
				case 'reconcile':
					await this.reconcile(action.issue);
					break;
				case 'investigate':
					await this.investigate(action.issue);
					break;
				case 'implement':
					await this.implement(action.task, action.issue);
					break;
				case 'idle':
					console.log('Nothing to do. All issues are either in-progress or completed.');
					return;
			}

			if (!this.config.noSleep && i < this.config.maxIterations) {
				console.log('Sleeping 5s...');
				await new Promise((r) => setTimeout(r, 5000));
			}
		}

		console.log('');
		console.log('=== Iteration limit reached ===');
	}

	/**
	 * Decide the next action to take
	 */
	private async decideAction(): Promise<Action> {
		// Priority 1: Reconcile — issues with tasks-accepted where all tasks are done
		const acceptedIssues = await this.issues.listIssues({labels: [LABELS.TASKS_ACCEPTED]});
		for (const issue of acceptedIssues) {
			if (!this.tasks.hasRemainingTasks(issue.number)) {
				return {type: 'reconcile', issue};
			}
		}

		// Priority 2: Implement — find an available task
		const implementAction = await this.findAvailableTask(acceptedIssues);
		if (implementAction) {
			return implementAction;
		}

		// Priority 3: Investigate — find a new issue (no whitesmith labels)
		const allDevPulseLabels = Object.values(LABELS);
		const newIssues = await this.issues.listIssues({noLabels: allDevPulseLabels});
		if (newIssues.length > 0) {
			// Pick the oldest issue
			const issue = newIssues[newIssues.length - 1];
			return {type: 'investigate', issue};
		}

		return {type: 'idle'};
	}

	/**
	 * Find an available task to implement
	 */
	private async findAvailableTask(
		acceptedIssues: Issue[],
	): Promise<{type: 'implement'; task: Task; issue: Issue} | null> {
		for (const issue of acceptedIssues) {
			const issueTasks = this.tasks.listTasks(issue.number);

			for (const task of issueTasks) {
				// Check dependencies are satisfied
				if (!this.tasks.areDependenciesSatisfied(task)) {
					continue;
				}

				// Check if someone is already working on it (branch exists)
				const branch = `task/${task.id}`;
				const branchExists = await this.issues.remoteBranchExists(branch);
				if (branchExists) {
					continue;
				}

				return {type: 'implement', task, issue};
			}
		}

		return null;
	}

	/**
	 * Phase 1: Reconcile — mark issue as completed, close it
	 */
	private async reconcile(issue: Issue): Promise<void> {
		console.log(`Reconciling issue #${issue.number}: ${issue.title}`);
		console.log('All tasks completed. Marking issue as done.');

		await this.issues.addLabel(issue.number, LABELS.COMPLETED);
		await this.issues.removeLabel(issue.number, LABELS.TASKS_ACCEPTED);
		await this.issues.comment(
			issue.number,
			`✅ All tasks for this issue have been implemented and merged. Closing.`,
		);
		await this.issues.closeIssue(issue.number);

		console.log(`Issue #${issue.number} closed.`);
	}

	/**
	 * Phase 2: Investigate — generate tasks for a new issue
	 */
	private async investigate(issue: Issue): Promise<void> {
		console.log(`Investigating issue #${issue.number}: ${issue.title}`);

		// Claim the issue
		await this.issues.addLabel(issue.number, LABELS.INVESTIGATING);

		const branch = `investigate/${issue.number}`;
		const issueTasksDir = `tasks/${issue.number}`;

		try {
			// Create branch from main
			await this.git.deleteLocalBranch(branch);
			await this.git.checkout(branch, {create: true, startPoint: 'origin/main'});

			// Run agent to generate tasks
			const prompt = buildInvestigatePrompt(issue, issueTasksDir);
			const {exitCode} = await this.agent.run({
				prompt,
				workDir: this.config.workDir,
				logFile: this.config.logFile,
			});

			if (exitCode !== 0) {
				console.error(`Agent failed with exit code ${exitCode}`);
				await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
				await this.git.checkoutMain();
				return;
			}

			// Verify task files were created
			await this.git.verifyBranch(branch);
			const tasks = this.tasks.listTasks(issue.number);
			if (tasks.length === 0) {
				console.error('Agent did not create any task files');
				await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
				await this.git.checkoutMain();
				return;
			}

			// Ensure changes are committed
			await this.git.commitAll(`tasks(#${issue.number}): generate implementation tasks`);

			console.log(`Generated ${tasks.length} task(s) for issue #${issue.number}`);

			if (this.config.noPush) {
				console.log(`Branch '${branch}' ready (--no-push mode)`);
			} else {
				// Push and create PR
				await this.git.push(branch);

				const taskList = tasks.map((t) => `- [ ] **${t.id}**: ${t.title}`).join('\n');
				const prUrl = await this.issues.createPR({
					head: branch,
					base: 'main',
					title: `tasks(#${issue.number}): ${issue.title}`,
					body: `## Generated Tasks for #${issue.number}\n\n${taskList}\n\n---\n*Generated by whitesmith from issue #${issue.number}*`,
				});

				await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
				await this.issues.addLabel(issue.number, LABELS.TASKS_PROPOSED);
				await this.issues.comment(
					issue.number,
					`📋 Tasks have been generated. Review the PR: ${prUrl}`,
				);

				console.log(`PR created: ${prUrl}`);
			}
		} catch (error) {
			console.error('Investigation failed:', error instanceof Error ? error.message : error);
			await this.issues.removeLabel(issue.number, LABELS.INVESTIGATING);
		}

		// Return to main
		await this.git.checkoutMain();
	}

	/**
	 * Phase 3: Implement — implement a task and create a PR
	 */
	private async implement(task: Task, issue: Issue): Promise<void> {
		console.log(`Implementing task ${task.id}: ${task.title}`);
		console.log(`For issue #${issue.number}: ${issue.title}`);

		const branch = `task/${task.id}`;

		try {
			// Create branch from main
			await this.git.deleteLocalBranch(branch);
			await this.git.checkout(branch, {create: true, startPoint: 'origin/main'});

			// Run agent to implement
			const prompt = buildImplementPrompt(task, issue);
			const {exitCode} = await this.agent.run({
				prompt,
				workDir: this.config.workDir,
				logFile: this.config.logFile,
			});

			if (exitCode !== 0) {
				console.error(`Agent failed with exit code ${exitCode}`);
				await this.git.checkoutMain();
				return;
			}

			// Verify we're still on the right branch
			await this.git.verifyBranch(branch);

			// Ensure changes are committed
			await this.git.commitAll(`feat(#${issue.number}): ${task.title}`);

			if (this.config.noPush) {
				console.log(`Branch '${branch}' ready (--no-push mode)`);
			} else {
				// Push and create PR
				await this.git.push(branch);

				const prUrl = await this.issues.createPR({
					head: branch,
					base: 'main',
					title: `feat(#${issue.number}): ${task.title}`,
					body: `## Task: ${task.title}\n\nImplements task \`${task.id}\` from issue #${issue.number}.\n\n### From the task spec:\n\n${task.content}\n\n---\n*Implemented by whitesmith*\n\nCloses #${issue.number} (if all tasks are complete)`,
				});

				console.log(`PR created: ${prUrl}`);
			}
		} catch (error) {
			console.error('Implementation failed:', error instanceof Error ? error.message : error);
		}

		// Return to main
		await this.git.checkoutMain();
	}
}
