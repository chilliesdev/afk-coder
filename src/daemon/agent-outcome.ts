import { Outcome, TokenUsage, AgentError, ExecutionDecision, Task } from '../common/types';

export class OutcomeAnalyzer {
  constructor(private maxRetries: number = 3) {}

  analyze(
    logs: string,
    exitCode: number,
    currentRetry: number,
    newlyCompletedCount: number
  ): ExecutionDecision {
    const tokens = this.extractTokenUsage(logs);
    const hasNewCompletedTasks = newlyCompletedCount > 0;

    let error = this.classifyError(logs, exitCode);

    if (exitCode === 0 && !hasNewCompletedTasks) {
      error = {
        type: 'NoProgress',
        message: 'Agent reported no progress could be made'
      };
    }

    if (exitCode === 0 && hasNewCompletedTasks) {
      return {
        action: 'next',
        delayMs: 5000,
        tokens,
      };
    }

    const resolvedError = error || { type: 'Runtime', message: `Agent exited with code ${exitCode}` };

    if (resolvedError.type === 'Safety' || resolvedError.type === 'NoProgress') {
      return {
        action: 'fail',
        delayMs: 0,
        tokens,
        error: resolvedError
      };
    }

    const nextRetry = currentRetry + 1;
    if (nextRetry > this.maxRetries) {
      return {
        action: 'fail',
        delayMs: 0,
        tokens,
        error: resolvedError
      };
    }

    let delayMs = Math.pow(2, nextRetry) * 5000;
    if (resolvedError.type === 'Quota') {
      delayMs = Math.max(delayMs, 60000);
    }
    return {
      action: 'retry',
      delayMs,
      tokens,
      error: resolvedError
    };
  }

  parseAgentOutput(logs: string, exitCode: number): Outcome {
    const tokens = this.extractTokenUsage(logs);

    if (exitCode === 0) {
      return {
        success: true,
        tokens
      };
    }

    const error = this.classifyError(logs, exitCode);
    return {
      success: false,
      tokens,
      error: error || { type: 'Runtime', message: `Agent exited with code ${exitCode}` }
    };
  }

  private extractTokenUsage(logs: string): TokenUsage {
    const tokenPatterns = [
      /usage:\s*{\s*prompt_tokens:\s*(\d+),\s*completion_tokens:\s*(\d+)/i, // JSON-like
      /Token usage:\s+(\d+)\s+prompt,\s+(\d+)\s+completion/i,
      /(\d+)\s*prompt tokens,?\s*(\d+)\s*completion tokens/i,
      /tokens:\s*(\d+)\s*in,\s*(\d+)\s*out/i,
      /input:\s*(\d+),\s*output:\s*(\d+)/i,
      /(?:Tokens|Usage):?\s*(?:input:?\s*)?(\d+)\s+(?:input|prompt)?(?:s)?,?\s*(?:output:?\s*)?(\d+)\s*(?:output|completion)?(?:s)?/i
    ];

    for (const pattern of tokenPatterns) {
      const match = logs.match(pattern);
      if (match) {
        const input = parseInt(match[1], 10);
        const output = parseInt(match[2], 10);
        return {
          input,
          output,
          total: input + output
        };
      }
    }

    return { input: 0, output: 0, total: 0 };
  }

  private classifyError(logs: string, exitCode: number): AgentError | undefined {
    // Quota Errors
    if (/429|Too Many Requests|Quota exceeded|Resource has been exhausted/i.test(logs)) {
      return {
        type: 'Quota',
        message: 'Gemini API quota exceeded'
      };
    }

    // Safety Errors
    if (/Candidate was blocked due to safety/i.test(logs)) {
      return {
        type: 'Safety',
        message: 'Task blocked by safety filters'
      };
    }

    // NoProgress Errors
    if (/No progress could be made|I am stuck|I cannot proceed|No changes were made/i.test(logs)) {
      return {
        type: 'NoProgress',
        message: 'Agent reported no progress could be made'
      };
    }

    return undefined;
  }
}
