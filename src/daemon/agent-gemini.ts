import { AgentAdapter } from './agent-adapter';

export class GeminiAdapter implements AgentAdapter {
  getAutonomousLoopCommand(): string {
    return `gemini --yolo --output-format json --prompt "Open tasks.md and identify the highest priority uncompleted task (marked with '- [ ]'). Your objective is to implement the necessary code for this task. Explore the codebase, write the code, and thoroughly verify your changes. Once completed and verified, open tasks.md again and mark ONLY that specific task as done by changing '- [ ]' to '- [x]'. Do not work on multiple tasks at once. Exit the session when finished."`;
  }

  getTaskGenerationCommand(prdFilename: string): string {
    return String.raw`gemini --yolo --prompt "Read the ${prdFilename} file. Break down the requirements into granular, actionable implementation tasks. Create a new file named tasks.md and write the tasks into it. Format each task exactly as \"- [ ] Task description\". Do not output the tasks to the console; you must write them directly to the tasks.md file."`;
  }

  getQALoopCommand(): string {
    return `gemini --yolo --output-format json --prompt "Read the PRD.md file and examine the codebase. Start the application if necessary to test it, and interact with it through external channels (e.g. HTTP, curl) as an end user would. Verify that all requirements in PRD.md are met. If you find any failures, bugs, or missing requirements, append them as new, uncompleted tasks to the end of tasks.md. Every new task must be formatted exactly as '- [ ] Task description [PRD: section or requirement name]'. Do NOT add any tasks that go beyond the scope of PRD.md. If all tests pass and there are no gaps, do not modify tasks.md. Exit when finished."`;
  }

  getCommitMessageCommand(): string {
    return `gemini --yolo --prompt "Analyze the git status and git diff of the repository. Generate a concise, one-line git commit message that describes the uncommitted changes. Output ONLY the commit message and nothing else."`;
  }
}
