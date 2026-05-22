export interface AgentAdapter {
  /**
   * Returns the CLI command to run the autonomous coding loop.
   */
  getAutonomousLoopCommand(): string;

  /**
   * Returns the CLI command to generate tasks from a PRD.
   * @param prdFilename The name of the PRD file (e.g., 'PRD.md').
   */
  getTaskGenerationCommand(prdFilename: string): string;

  /**
   * Returns the CLI command to run the QA loop.
   */
  getQALoopCommand(): string;
}
