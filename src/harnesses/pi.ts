import {exec, execSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type {AgentHarness, AgentHarnessConfig} from './agent-harness.js';

/**
 * Agent harness for @mariozechner/pi-coding-agent.
 *
 * Runs `pi` with a prompt passed via a temp file, captures output.
 */
export class PiHarness implements AgentHarness {
	private cmd: string;
	private provider: string;
	private model: string;

	constructor(config: AgentHarnessConfig) {
		this.cmd = config.cmd;
		this.provider = config.provider;
		this.model = config.model;
	}

	async validate(): Promise<void> {
		// Check if the command exists
		try {
			execSync(`which ${this.cmd}`, {stdio: 'pipe'});
		} catch {
			throw new Error(
				`Agent command '${this.cmd}' not found. ` +
					`Make sure it is installed and available in PATH. ` +
					`For pi-coding-agent: npm install -g @mariozechner/pi-coding-agent`,
			);
		}

		// Validate auth by making a minimal API call
		try {
			const result = execSync(
				`${this.cmd} --print --no-tools --provider ${this.provider} --model ${this.model} "respond with OK"`,
				{stdio: 'pipe', timeout: 30_000},
			);
			const output = result.toString().trim();
			if (!output) {
				throw new Error('Empty response');
			}
			console.log(`Auth check passed (response: ${output.slice(0, 20)})`);
		} catch (error: any) {
			const stderr = error.stderr?.toString() || error.message || '';
			throw new Error(
				`Agent auth validation failed. Ensure valid credentials are configured.\n` +
					`Set ANTHROPIC_API_KEY or configure OAuth via ~/.pi/agent/auth.json\n` +
					`Details: ${stderr.slice(0, 500)}`,
			);
		}
	}

	async run(options: {
		prompt: string;
		workDir: string;
		logFile?: string;
	}): Promise<{output: string; exitCode: number}> {
		// Write prompt to a temp file to avoid shell escaping issues
		const promptFile = path.join(options.workDir, '.whitesmith-prompt.md');
		fs.writeFileSync(promptFile, options.prompt, 'utf-8');

		try {
			const result = await this.exec(
				`${this.cmd} --prompt-file "${promptFile}" --yes --provider ${this.provider} --model ${this.model}`,
				options.workDir,
				options.logFile,
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
		logFile?: string,
	): Promise<{output: string; exitCode: number}> {
		return new Promise((resolve) => {
			const child = exec(cmd, {
				cwd: workDir,
				maxBuffer: 50 * 1024 * 1024,
				timeout: 30 * 60 * 1000, // 30 minute timeout
			});

			let output = '';
			const logStream = logFile
				? fs.createWriteStream(path.resolve(workDir, logFile), {flags: 'a'})
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
				resolve({output, exitCode: code ?? 1});
			});
		});
	}
}
