import type {AgentHarness} from './harnesses/agent-harness.js';
import type {IssueProvider} from './providers/issue-provider.js';
import {GitManager} from './git.js';

export interface CommentConfig {
	/** Issue or PR number */
	number: number;
	/** The comment body text */
	commentBody: string;
	/** Working directory (the repo) */
	workDir: string;
	/** GitHub repo in "owner/repo" format (auto-detected if not set) */
	repo?: string;
	/** Log file path */
	logFile?: string;
	/** Whether to post the response as a GitHub comment (issue-only) */
	post: boolean;
}

/**
 * Handle a comment on a PR.
 *
 * Checks out the PR branch, runs the agent with instructions to make changes,
 * commits and pushes to the PR branch.
 */
export async function handlePRComment(
	config: CommentConfig,
	issues: IssueProvider,
	agent: AgentHarness,
): Promise<void> {
	const git = new GitManager(config.workDir);
	const issue = await issues.getIssue(config.number);

	// Get PR branch
	const prBranch = await getPRBranch(issues, config.number);
	console.log(`PR #${config.number}: ${issue.title}`);
	console.log(`Branch: ${prBranch}`);

	// Checkout PR branch
	await git.fetch();
	await git.checkout(prBranch);

	const prompt = buildPRCommentPrompt({
		title: issue.title,
		url: issue.url,
		number: config.number,
		body: issue.body,
		branch: prBranch,
		commentBody: config.commentBody,
	});

	const {exitCode} = await agent.run({
		prompt,
		workDir: config.workDir,
		logFile: config.logFile,
	});

	if (exitCode !== 0) {
		throw new Error(`Agent failed with exit code ${exitCode}`);
	}

	// Commit and push any changes
	const committed = await git.commitAll(`fix(#${config.number}): address review comment`);
	if (committed) {
		await git.push(prBranch);
		console.log(`Changes pushed to ${prBranch}`);
	} else {
		console.log('No changes to commit.');
	}
}

/**
 * Handle a comment on an issue (not a PR).
 *
 * Runs the agent with read-only instructions to analyze the codebase and produce
 * a response. The response is either printed to stdout or posted as a GitHub comment.
 */
export async function handleIssueComment(
	config: CommentConfig,
	issues: IssueProvider,
	agent: AgentHarness,
): Promise<void> {
	const issue = await issues.getIssue(config.number);
	console.log(`Issue #${config.number}: ${issue.title}`);

	const responseFile = '.whitesmith-response.md';
	const prompt = buildIssueCommentPrompt({
		title: issue.title,
		url: issue.url,
		number: config.number,
		body: issue.body,
		commentBody: config.commentBody,
		responseFile,
	});

	const {exitCode} = await agent.run({
		prompt,
		workDir: config.workDir,
		logFile: config.logFile,
	});

	if (exitCode !== 0) {
		throw new Error(`Agent failed with exit code ${exitCode}`);
	}

	// Read the response file
	const fs = await import('node:fs');
	const path = await import('node:path');
	const responsePath = path.join(config.workDir, responseFile);

	if (!fs.existsSync(responsePath)) {
		console.error('Agent did not produce a response file.');
		process.exitCode = 1;
		return;
	}

	const response = fs.readFileSync(responsePath, 'utf-8');

	// Clean up the response file
	try {
		fs.unlinkSync(responsePath);
	} catch {
		// ignore
	}

	if (config.post) {
		await issues.comment(config.number, response);
		console.log(`Response posted as comment on issue #${config.number}`);
	} else {
		// Print to stdout
		process.stdout.write(response);
	}
}

/**
 * Detect whether a given number is a PR or an issue.
 * Uses `gh pr view` — if it succeeds, it's a PR.
 */
export async function isPullRequest(issues: IssueProvider, number: number): Promise<boolean> {
	try {
		// Try to get PR branch — if this succeeds, it's a PR
		await getPRBranch(issues, number);
		return true;
	} catch {
		return false;
	}
}

async function getPRBranch(issues: IssueProvider, number: number): Promise<string> {
	// Use gh CLI directly since IssueProvider doesn't have a PR-specific method
	const {exec} = await import('node:child_process');
	const {promisify} = await import('node:util');
	const execAsync = promisify(exec);

	const {stdout} = await execAsync(`gh pr view ${number} --json headRefName -q .headRefName`);
	return stdout.trim();
}

// --- Prompt builders ---

interface PRCommentPromptArgs {
	title: string;
	url: string;
	number: number;
	body: string;
	branch: string;
	commentBody: string;
}

function buildPRCommentPrompt(args: PRCommentPromptArgs): string {
	return `# Agent Task from PR Comment

## Pull Request

- **Title:** ${args.title}
- **URL:** ${args.url}
- **PR Number:** #${args.number}
- **Branch:** ${args.branch}

### PR Description

${args.body}

## Triggering Comment

${args.commentBody}

## Instructions

You are working on a pull request. The comment above is a request from a reviewer or contributor.

1. You are already on the PR branch: \`${args.branch}\`
2. Read and understand the comment request.
3. Make the requested changes.
4. Commit your changes with a descriptive message.

Do NOT push. Do NOT create a new PR. The caller will handle pushing.
`;
}

interface IssueCommentPromptArgs {
	title: string;
	url: string;
	number: number;
	body: string;
	commentBody: string;
	responseFile: string;
}

function buildIssueCommentPrompt(args: IssueCommentPromptArgs): string {
	return `# Agent Task from Issue Comment

## Issue

- **Title:** ${args.title}
- **URL:** ${args.url}
- **Issue Number:** #${args.number}

### Issue Description

${args.body}

## Triggering Comment

${args.commentBody}

## Instructions

You are responding to a comment on an issue (not a pull request).

1. Read and understand the issue description and the triggering comment.
2. You have full access to the repository code — read files, explore the codebase as needed.
3. Analyze the request and formulate a helpful response.
4. Write your response in Markdown to the file \`${args.responseFile}\`.

Your response will be posted as a comment on the issue.
Be thorough but concise. Include code snippets, file references, or suggestions as appropriate.
Do NOT create branches, commits, or pull requests.
`;
}
