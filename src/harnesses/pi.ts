import { exec } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentHarness } from './agent-harness.js';

/**
 * Agent harness for @mariozechner/pi-coding-agent.
 *
 * Runs `pi` with a prompt passed via a temp file, captures output.
 */
export class PiHarness implements AgentHarness {
	private cmd: string;

	/**
	 * @param cmd - Command to invoke pi (default: "pi")
	 */
	constructor(cmd: string = 'pi') {
		this.cmd = cmd;
	}

	async run(options: {
		prompt: string;
		workDir: string;
		logFile?: string;
	}): Promise<{ output: string; exitCode: number }> {
		// Write prompt to a temp file to avoid shell escaping issues
		const promptFile = path.join(options.workDir, '.dev-pulse-prompt.md');
		fs.writeFileSync(promptFile, options.prompt, 'utf-8');

		try {
			const result = await this.exec(
				`${this.cmd} --prompt-file "${promptFile}" --yes`,
				options.workDir,
				options.logFile
			);
			return result;
		} finally {
			// Clean up prompt file
			try {
				fs.unlinkSync(promptFile);
			} catch {
				// Ignore
			}
		}
	}

	private exec(
		cmd: string,
		workDir: string,
		logFile?: string
	): Promise<{ output: string; exitCode: number }> {
		return new Promise((resolve) => {
			const child = exec(cmd, {
				cwd: workDir,
				maxBuffer: 50 * 1024 * 1024,
				timeout: 30 * 60 * 1000, // 30 minute timeout
			});

			let output = '';
			const logStream = logFile
				? fs.createWriteStream(path.resolve(workDir, logFile), { flags: 'a' })
				: null;

			child.stdout?.on('data', (data: string) => {
				output += data;
				process.stdout.write(data);
				logStream?.write(data);
			});

			child.stderr?.on('data', (data: string) => {
				output += data;
				process.stderr.write(data);
				logStream?.write(data);
			});

			child.on('close', (code) => {
				logStream?.end();
				resolve({ output, exitCode: code ?? 1 });
			});
		});
	}
}
