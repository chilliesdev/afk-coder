import { Outcome, TokenUsage, AgentError, ExecutionDecision } from '../common/types';

export class AgentOutcomeEvaluator {
  constructor(private maxRetries: number = 3) {}

  evaluate(
    logs: string,
    exitCode: number,
    currentRetry: number,
    hasNewCompletedTasks: boolean
  ): ExecutionDecision {
    const tokens = extractTokenUsage(logs);

    let error = classifyError(logs, exitCode);

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
        tokens
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
    if (nextRetry <= this.maxRetries) {
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
    } else {
      return {
        action: 'fail',
        delayMs: 0,
        tokens,
        error: resolvedError
      };
    }
  }
}

/**
 * Parses raw stdout/stderr and exit codes from the Gemini CLI Agent.
 * Distills raw execution data into a structured Outcome.
 */
export function parseAgentOutput(logs: string, exitCode: number): Outcome {
  const tokens = extractTokenUsage(logs);

  if (exitCode === 0) {
    return {
      success: true,
      tokens
    };
  }

  const error = classifyError(logs, exitCode);
  return {
    success: false,
    tokens,
    error: error || { type: 'Runtime', message: `Agent exited with code ${exitCode}` }
  };
}

/**
 * Extracts token usage information from logs using various known patterns.
 */
function extractTokenUsage(logs: string): TokenUsage {
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

/**
 * Classifies the error based on logs and exit code.
 */
function classifyError(logs: string, exitCode: number): AgentError | undefined {
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
  // These are often detected when the agent explicitly states it cannot proceed
  // or when the logs indicate a loop without changes.
  if (/No progress could be made|I am stuck|I cannot proceed|No changes were made/i.test(logs)) {
    return {
      type: 'NoProgress',
      message: 'Agent reported no progress could be made'
    };
  }

  return undefined;
}
