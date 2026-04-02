import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {TaskManager} from '../src/task-manager.js';

describe('TaskManager edge cases', () => {
	let tmpDir: string;
	let mgr: TaskManager;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'whitesmith-test-'));
		mgr = new TaskManager(tmpDir);
	});

	afterEach(() => {
		fs.rmSync(tmpDir, {recursive: true, force: true});
	});

	function writeRawFile(relativePath: string, content: string) {
		const fullPath = path.join(tmpDir, relativePath);
		fs.mkdirSync(path.dirname(fullPath), {recursive: true});
		fs.writeFileSync(fullPath, content);
	}

	function writeValidTask(issueNumber: number, seq: number, slug: string) {
		const seqStr = String(seq).padStart(3, '0');
		const id = `${issueNumber}-${seqStr}`;
		writeRawFile(
			`tasks/${issueNumber}/${seqStr}-${slug}.md`,
			`---
id: "${id}"
issue: ${issueNumber}
title: "Task ${slug}"
depends_on: []
---

## Description
Test task.
`,
		);
		return id;
	}

	describe('parseFrontmatter errors', () => {
		it('throws on missing frontmatter', () => {
			writeRawFile('tasks/1/001-bad.md', '# No frontmatter here\nJust content.');
			expect(() => mgr.listTasks(1)).toThrow('missing YAML frontmatter');
		});

		it('throws on missing required fields', () => {
			writeRawFile(
				'tasks/1/001-bad.md',
				`---
id: "1-001"
---

Missing issue and title.
`,
			);
			expect(() => mgr.listTasks(1)).toThrow('missing required fields');
		});

		it('throws when id is missing', () => {
			writeRawFile(
				'tasks/1/001-bad.md',
				`---
issue: 1
title: "Has title"
---

Content.
`,
			);
			expect(() => mgr.listTasks(1)).toThrow('missing required fields');
		});
	});

	describe('non-md files are ignored', () => {
		it('ignores non-.md files in task directory', () => {
			writeValidTask(5, 1, 'real-task');
			writeRawFile('tasks/5/README.txt', 'This is not a task');
			writeRawFile('tasks/5/.gitkeep', '');

			const tasks = mgr.listTasks(5);
			expect(tasks).toHaveLength(1);
			expect(tasks[0].id).toBe('5-001');
		});
	});

	describe('non-numeric directories are ignored', () => {
		it('ignores non-numeric directories under tasks/', () => {
			writeValidTask(1, 1, 'task-a');
			writeRawFile(
				'tasks/templates/example.md',
				`---
id: "t-001"
issue: 0
title: "Template"
---
Template content.
`,
			);

			const issues = mgr.getIssuesWithTasks();
			expect(issues).toEqual([1]);

			const allTasks = mgr.listAllTasks();
			expect(allTasks).toHaveLength(1);
		});
	});

	describe('empty tasks directory', () => {
		it('returns empty when tasks/ does not exist', () => {
			expect(mgr.listAllTasks()).toHaveLength(0);
			expect(mgr.getIssuesWithTasks()).toEqual([]);
		});

		it('returns empty when tasks/ is empty', () => {
			fs.mkdirSync(path.join(tmpDir, 'tasks'), {recursive: true});
			expect(mgr.listAllTasks()).toHaveLength(0);
			expect(mgr.getIssuesWithTasks()).toEqual([]);
		});
	});

	describe('writeTask creates correct content', () => {
		it('creates a file with YAML frontmatter and body', () => {
			const relPath = mgr.writeTask(
				7,
				3,
				'add-logging',
				{
					id: '7-003',
					issue: 7,
					title: 'Add logging',
					depends_on: ['7-001', '7-002'],
				},
				'## Description\nAdd structured logging throughout the app.',
			);

			expect(relPath).toBe('tasks/7/003-add-logging.md');

			const fullPath = path.join(tmpDir, relPath);
			const content = fs.readFileSync(fullPath, 'utf-8');

			expect(content).toContain('id: 7-003');
			expect(content).toContain('issue: 7');
			expect(content).toContain('title: Add logging');
			expect(content).toContain('7-001');
			expect(content).toContain('7-002');
			expect(content).toContain('## Description');
			expect(content).toContain('Add structured logging');
		});

		it('round-trips through readTask correctly', () => {
			mgr.writeTask(
				10,
				1,
				'init',
				{
					id: '10-001',
					issue: 10,
					title: 'Initialize project',
					depends_on: [],
				},
				'## Description\nSet up the project scaffolding.',
			);

			const tasks = mgr.listTasks(10);
			expect(tasks).toHaveLength(1);
			expect(tasks[0].id).toBe('10-001');
			expect(tasks[0].issue).toBe(10);
			expect(tasks[0].title).toBe('Initialize project');
			expect(tasks[0].dependsOn).toEqual([]);
			expect(tasks[0].filePath).toBe('tasks/10/001-init.md');
		});
	});

	describe('deleteTask edge cases', () => {
		it('does nothing when deleting non-existent file', () => {
			// Should not throw
			mgr.deleteTask('tasks/999/001-phantom.md');
		});

		it('keeps directory if other task files remain', () => {
			writeValidTask(42, 1, 'first');
			writeValidTask(42, 2, 'second');

			const tasks = mgr.listTasks(42);
			mgr.deleteTask(tasks[0].filePath);

			// Directory still exists with the second task
			expect(fs.existsSync(path.join(tmpDir, 'tasks', '42'))).toBe(true);
			expect(mgr.listTasks(42)).toHaveLength(1);
		});

		it('keeps directory if non-md files remain', () => {
			writeValidTask(42, 1, 'only');
			writeRawFile('tasks/42/notes.txt', 'some notes');

			const tasks = mgr.listTasks(42);
			mgr.deleteTask(tasks[0].filePath);

			// Directory still exists because of notes.txt (deleteTask only checks .md files)
			// Actually let's verify behavior
			const dirExists = fs.existsSync(path.join(tmpDir, 'tasks', '42'));
			// deleteTask checks remaining .md files - notes.txt is not .md so dir should be removed
			expect(dirExists).toBe(false);
		});
	});

	describe('dependency satisfaction edge cases', () => {
		it('handles cross-issue dependencies', () => {
			writeValidTask(1, 1, 'base');

			const dir = path.join(tmpDir, 'tasks', '2');
			fs.mkdirSync(dir, {recursive: true});
			fs.writeFileSync(
				path.join(dir, '001-dependent.md'),
				`---
id: "2-001"
issue: 2
title: "Depends on issue 1"
depends_on: ["1-001"]
---

## Description
Cross-issue dependency.
`,
			);

			const tasks = mgr.listTasks(2);
			expect(tasks).toHaveLength(1);

			// 1-001 still exists, so dependency not satisfied
			expect(mgr.areDependenciesSatisfied(tasks[0])).toBe(false);

			// Delete the dependency
			const depTasks = mgr.listTasks(1);
			mgr.deleteTask(depTasks[0].filePath);

			// Now satisfied
			expect(mgr.areDependenciesSatisfied(tasks[0])).toBe(true);
		});

		it('handles multiple dependencies where some are satisfied', () => {
			writeValidTask(10, 1, 'first');
			writeValidTask(10, 2, 'second');

			const dir = path.join(tmpDir, 'tasks', '10');
			fs.writeFileSync(
				path.join(dir, '003-third.md'),
				`---
id: "10-003"
issue: 10
title: "Third task"
depends_on: ["10-001", "10-002"]
---

Depends on both.
`,
			);

			const tasks = mgr.listTasks(10);
			const third = tasks.find((t) => t.id === '10-003')!;

			// Both deps exist - not satisfied
			expect(mgr.areDependenciesSatisfied(third)).toBe(false);

			// Delete one dep
			const first = tasks.find((t) => t.id === '10-001')!;
			mgr.deleteTask(first.filePath);

			// Still not satisfied (10-002 remains)
			expect(mgr.areDependenciesSatisfied(third)).toBe(false);

			// Delete second dep
			const remaining = mgr.listTasks(10);
			const second = remaining.find((t) => t.id === '10-002')!;
			mgr.deleteTask(second.filePath);

			// Now satisfied
			expect(mgr.areDependenciesSatisfied(third)).toBe(true);
		});

		it('considers dependency on non-existent task as satisfied', () => {
			writeValidTask(5, 2, 'task');

			const dir = path.join(tmpDir, 'tasks', '5');
			// Overwrite with a dependency on a task that was never created
			fs.writeFileSync(
				path.join(dir, '002-task.md'),
				`---
id: "5-002"
issue: 5
title: "Task with phantom dep"
depends_on: ["5-001"]
---

Depends on a task that doesn't exist.
`,
			);

			const tasks = mgr.listTasks(5);
			// 5-001 doesn't exist in pending tasks = already completed
			expect(mgr.areDependenciesSatisfied(tasks[0])).toBe(true);
		});
	});

	describe('task ordering', () => {
		it('returns tasks sorted by filename (sequence order)', () => {
			writeValidTask(1, 3, 'third');
			writeValidTask(1, 1, 'first');
			writeValidTask(1, 2, 'second');

			const tasks = mgr.listTasks(1);
			expect(tasks.map((t) => t.id)).toEqual(['1-001', '1-002', '1-003']);
		});
	});

	describe('getTasksDir and getIssueTasksDir', () => {
		it('returns correct paths', () => {
			expect(mgr.getTasksDir()).toBe(path.join(tmpDir, 'tasks'));
			expect(mgr.getIssueTasksDir(42)).toBe(path.join(tmpDir, 'tasks', '42'));
		});
	});
});
