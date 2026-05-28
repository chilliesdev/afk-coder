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

  /**
   * Returns the CLI command to generate a commit message based on the repository's git status/diff.
   */
  getCommitMessageCommand(): string;
}

export type AgentAdapterConstructor = new () => AgentAdapter;

export class AgentAdapterRegistry {
  private static registry = new Map<string, AgentAdapterConstructor>();

  static register(name: string, constructor: AgentAdapterConstructor): void {
    this.registry.set(name, constructor);
  }

  static get(name: string): AgentAdapter {
    const Constructor = this.registry.get(name);
    if (!Constructor) {
      throw new Error(`Agent adapter "${name}" is not registered.`);
    }
    return new Constructor();
  }

  static has(name: string): boolean {
    return this.registry.has(name);
  }
}

