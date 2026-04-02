#!/usr/bin/env node

import {Command} from 'commander';
import * as path from 'node:path';
import * as fs from 'node:fs';
import type {DevPulseConfig} from './types.js';
import {LABELS} from './types.js';
import {Orchestrator} from './orchestrator.js';
import {GitHubProvider} from './providers/github.js';
import {PiHarness} from './harnesses/pi.js';
import {TaskManager} from './task-manager.js';

const DEFAULT_AGENT_CMD = 'pi';
const DEFAULT_MAX_ITERATIONS = 10;

function createOrchestrator(config: DevPulseConfig): Orchestrator {
	const issues = new GitHubProvider(config.workDir, config.repo);
	const agent = new PiHarness(config.agentCmd);
	return new Orchestrator(config, issues, agent);
}

export function buildCli(): Command {
	const program = new Command();

	program.name('dev-pulse').description('AI-powered issue-to-PR pipeline').version('0.0.0');

	// --- run ---
	program
		.command('run')
		.description('Run the main dev-pulse loop: investigate issues, implement tasks')
		.argument('[work_dir]', 'Working directory', '.')
		.option('--agent-cmd <cmd>', 'Agent harness command', DEFAULT_AGENT_CMD)
		.option('--max-iterations <n>', 'Max iterations', String(DEFAULT_MAX_ITERATIONS))
		.option('--repo <owner/repo>', 'GitHub repo (auto-detected if omitted)')
		.option('--log-file <path>', 'Log agent output to file')
		.option('--no-push', 'Skip pushing and PR creation')
		.option('--no-sleep', 'Skip sleep between iterations')
		.action(async (workDir: string, opts) => {
			const config: DevPulseConfig = {
				agentCmd: opts.agentCmd,
				maxIterations: parseInt(opts.maxIterations, 10),
				workDir: path.resolve(workDir),
				noPush: opts.push === false,
				noSleep: opts.sleep === false,
				logFile: opts.logFile,
				repo: opts.repo,
			};

			if (!fs.existsSync(config.workDir)) {
				console.error(`ERROR: Directory '${config.workDir}' does not exist`);
				process.exit(1);
			}

			process.chdir(config.workDir);
			const orchestrator = createOrchestrator(config);

			try {
				await orchestrator.run();
			} catch (error) {
				console.error('ERROR:', error instanceof Error ? error.message : error);
				process.exit(1);
			}
		});

	// --- status ---
	program
		.command('status')
		.description('Show current status of issues and tasks')
		.argument('[work_dir]', 'Working directory', '.')
		.option('--repo <owner/repo>', 'GitHub repo')
		.action(async (workDir: string, opts) => {
			const resolvedDir = path.resolve(workDir);
			const issues = new GitHubProvider(resolvedDir, opts.repo);
			const taskMgr = new TaskManager(resolvedDir);

			console.log('=== dev-pulse status ===\n');

			// Show issues by state
			for (const [name, label] of Object.entries(LABELS)) {
				const list = await issues.listIssues({labels: [label]});
				if (list.length > 0) {
					console.log(`${name} (${label}):`);
					for (const issue of list) {
						console.log(`  #${issue.number} - ${issue.title}`);
					}
					console.log('');
				}
			}

			// Show new issues (no dev-pulse labels)
			const allLabels = Object.values(LABELS);
			const newIssues = await issues.listIssues({noLabels: allLabels});
			if (newIssues.length > 0) {
				console.log('NEW (no label):');
				for (const issue of newIssues) {
					console.log(`  #${issue.number} - ${issue.title}`);
				}
				console.log('');
			}

			// Show pending tasks
			const allTasks = taskMgr.listAllTasks();
			if (allTasks.length > 0) {
				console.log('PENDING TASKS:');
				for (const task of allTasks) {
					const deps = task.dependsOn.length > 0 ? ` (depends: ${task.dependsOn.join(', ')})` : '';
					console.log(`  ${task.id} - ${task.title}${deps}`);
				}
				console.log('');
			}
		});

	// --- reconcile ---
	program
		.command('reconcile')
		.description('Check for completed issues and close them (no AI needed)')
		.argument('[work_dir]', 'Working directory', '.')
		.option('--repo <owner/repo>', 'GitHub repo')
		.action(async (workDir: string, opts) => {
			const resolvedDir = path.resolve(workDir);
			const issues = new GitHubProvider(resolvedDir, opts.repo);
			const taskMgr = new TaskManager(resolvedDir);

			console.log('=== dev-pulse reconcile ===\n');

			// Also handle tasks-proposed → tasks-accepted transition
			// When a PR is merged, the tasks land on main, so if we see tasks on disk
			// for an issue labeled tasks-proposed, it means the PR was merged
			const proposedIssues = await issues.listIssues({labels: [LABELS.TASKS_PROPOSED]});
			for (const issue of proposedIssues) {
				if (taskMgr.hasRemainingTasks(issue.number)) {
					// Tasks exist on main = PR was merged
					console.log(`Issue #${issue.number}: tasks PR merged, marking as accepted`);
					await issues.removeLabel(issue.number, LABELS.TASKS_PROPOSED);
					await issues.addLabel(issue.number, LABELS.TASKS_ACCEPTED);
				}
			}

			// Check accepted issues for completion
			const acceptedIssues = await issues.listIssues({labels: [LABELS.TASKS_ACCEPTED]});
			for (const issue of acceptedIssues) {
				if (!taskMgr.hasRemainingTasks(issue.number)) {
					console.log(`Issue #${issue.number}: all tasks done, closing`);
					await issues.addLabel(issue.number, LABELS.COMPLETED);
					await issues.removeLabel(issue.number, LABELS.TASKS_ACCEPTED);
					await issues.comment(
						issue.number,
						'✅ All tasks for this issue have been implemented and merged. Closing.',
					);
					await issues.closeIssue(issue.number);
				}
			}

			console.log('Reconcile complete.');
		});

	return program;
}

export async function main(args: string[] = process.argv): Promise<void> {
	const program = buildCli();
	await program.parseAsync(args);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
