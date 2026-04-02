/**
 * Interface for AI agent harnesses.
 * Implementations wrap specific tools (pi, claude CLI, aider, etc.)
 */
export interface AgentHarness {
	/**
	 * Validate that the agent is available and properly configured.
	 * Throws an error with a descriptive message if validation fails.
	 */
	validate(): Promise<void>;

	/**
	 * Run the agent with a prompt and return its output.
	 * The agent is expected to execute in the given working directory.
	 */
	run(options: {
		prompt: string;
		workDir: string;
		logFile?: string;
	}): Promise<{output: string; exitCode: number}>;
}

export interface AgentHarnessConfig {
	/** Command to invoke the agent (e.g. 'pi') */
	cmd: string;
	/** AI provider name (e.g. 'anthropic', 'openai') */
	provider: string;
	/** AI model ID (e.g. 'claude-opus-4-6') */
	model: string;
}
