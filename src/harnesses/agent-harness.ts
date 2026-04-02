/**
 * Interface for AI agent harnesses.
 * Implementations wrap specific tools (pi, claude CLI, aider, etc.)
 */
export interface AgentHarness {
	/**
	 * Run the agent with a prompt and return its output.
	 * The agent is expected to execute in the given working directory.
	 */
	run(options: {
		prompt: string;
		workDir: string;
		logFile?: string;
	}): Promise<{ output: string; exitCode: number }>;
}
