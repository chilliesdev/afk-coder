export class AgentStrategy {
  /**
   * Returns the prompt for the autonomous agent loop.
   */
  getAutonomousLoopPrompt(): string {
    return `gemini --yolo --prompt "Open tasks.md and identify the highest priority uncompleted task (marked with '- [ ]'). Your objective is to implement the necessary code for this task. Explore the codebase, write the code, and thoroughly verify your changes. Once completed and verified, open tasks.md again and mark ONLY that specific task as done by changing '- [ ]' to '- [x]'. Do not work on multiple tasks at once. Exit the session when finished."`;
  }

  /**
   * Returns the prompt for generating tasks.md from PRD.md.
   */
  getTaskGenerationPrompt(prdFilename: string = 'PRD.md'): string {
    return `gemini --yolo --prompt "Read the ${prdFilename} file. Break down the requirements into granular, actionable implementation tasks. Create a new file named tasks.md and write the tasks into it. Format each task exactly as \\"- [ ] Task description\\". Do not output the tasks to the console; you must write them directly to the tasks.md file."`;
  }
}
