import * as fs from 'node:fs';
import * as path from 'node:path';
import {parse as parseYaml, stringify as stringifyYaml} from 'yaml';
import type {Task, TaskFrontmatter} from './types.js';

const TASKS_DIR = 'tasks';

/**
 * Manages task files in the tasks/ directory.
 *
 * Task files live at: tasks/<issue-number>/<seq>-<slug>.md
 * Each file has YAML frontmatter with id, issue, title, depends_on.
 */
export class TaskManager {
	private workDir: string;

	constructor(workDir: string) {
		this.workDir = workDir;
	}

	/**
	 * Get the tasks directory path
	 */
	getTasksDir(): string {
		return path.join(this.workDir, TASKS_DIR);
	}

	/**
	 * Get the directory for a specific issue's tasks
	 */
	getIssueTasksDir(issueNumber: number): string {
		return path.join(this.workDir, TASKS_DIR, String(issueNumber));
	}

	/**
	 * List all pending tasks for an issue (files in tasks/<issue>/)
	 */
	listTasks(issueNumber: number): Task[] {
		const dir = this.getIssueTasksDir(issueNumber);
		if (!fs.existsSync(dir)) return [];

		const files = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith('.md'))
			.sort();

		return files.map((f) => this.readTask(path.join(dir, f)));
	}

	/**
	 * List all pending tasks across all issues
	 */
	listAllTasks(): Task[] {
		const tasksDir = this.getTasksDir();
		if (!fs.existsSync(tasksDir)) return [];

		const issueDirs = fs
			.readdirSync(tasksDir)
			.filter((d) => {
				const fullPath = path.join(tasksDir, d);
				return fs.statSync(fullPath).isDirectory() && /^\d+$/.test(d);
			})
			.sort();

		const tasks: Task[] = [];
		for (const issueDir of issueDirs) {
			const issueNumber = parseInt(issueDir, 10);
			tasks.push(...this.listTasks(issueNumber));
		}
		return tasks;
	}

	/**
	 * Check if a task file exists (by its repo-relative path)
	 */
	taskFileExists(filePath: string): boolean {
		return fs.existsSync(path.resolve(this.workDir, filePath));
	}

	/**
	 * Check if an issue has any remaining (pending) tasks
	 */
	hasRemainingTasks(issueNumber: number): boolean {
		return this.listTasks(issueNumber).length > 0;
	}

	/**
	 * Get issue numbers that have task files
	 */
	getIssuesWithTasks(): number[] {
		const tasksDir = this.getTasksDir();
		if (!fs.existsSync(tasksDir)) return [];

		return fs
			.readdirSync(tasksDir)
			.filter((d) => {
				const fullPath = path.join(tasksDir, d);
				return fs.statSync(fullPath).isDirectory() && /^\d+$/.test(d);
			})
			.map((d) => parseInt(d, 10))
			.sort((a, b) => a - b);
	}

	/**
	 * Read and parse a single task file
	 */
	readTask(filePath: string): Task {
		const content = fs.readFileSync(filePath, 'utf-8');
		const frontmatter = this.parseFrontmatter(content);
		const relativePath = path.relative(this.workDir, filePath);

		return {
			id: frontmatter.id,
			issue: frontmatter.issue,
			title: frontmatter.title,
			dependsOn: frontmatter.depends_on || [],
			content,
			filePath: relativePath,
		};
	}

	/**
	 * Write a task file
	 */
	writeTask(
		issueNumber: number,
		seq: number,
		slug: string,
		frontmatter: TaskFrontmatter,
		body: string,
	): string {
		const dir = this.getIssueTasksDir(issueNumber);
		fs.mkdirSync(dir, {recursive: true});

		const seqStr = String(seq).padStart(3, '0');
		const fileName = `${seqStr}-${slug}.md`;
		const filePath = path.join(dir, fileName);

		const content = `---\n${stringifyYaml(frontmatter).trim()}\n---\n\n${body}`;
		fs.writeFileSync(filePath, content, 'utf-8');

		return path.relative(this.workDir, filePath);
	}

	/**
	 * Delete a task file (called when task is implemented)
	 */
	deleteTask(taskFilePath: string): void {
		const fullPath = path.resolve(this.workDir, taskFilePath);
		if (fs.existsSync(fullPath)) {
			fs.unlinkSync(fullPath);
		}

		// Clean up empty issue directory
		const dir = path.dirname(fullPath);
		if (fs.existsSync(dir)) {
			const remaining = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
			if (remaining.length === 0) {
				// Remove directory if no more task files
				fs.rmSync(dir, {recursive: true, force: true});
			}
		}
	}

	/**
	 * Check if all dependencies of a task are satisfied
	 * (i.e. their task files have been deleted from the tasks directory)
	 */
	areDependenciesSatisfied(task: Task): boolean {
		if (task.dependsOn.length === 0) return true;

		const allTasks = this.listAllTasks();
		const pendingIds = new Set(allTasks.map((t) => t.id));

		// A dependency is satisfied if its task file no longer exists (deleted = completed)
		return task.dependsOn.every((depId) => !pendingIds.has(depId));
	}

	/**
	 * Parse YAML frontmatter from a markdown file
	 */
	private parseFrontmatter(content: string): TaskFrontmatter {
		const match = content.match(/^---\n([\s\S]*?)\n---/);
		if (!match) {
			throw new Error('Task file is missing YAML frontmatter');
		}

		const parsed = parseYaml(match[1]) as TaskFrontmatter;
		if (!parsed.id || parsed.issue === undefined || !parsed.title) {
			throw new Error(
				`Task frontmatter is missing required fields (id, issue, title). Got: ${JSON.stringify(parsed)}`,
			);
		}

		return parsed;
	}
}
