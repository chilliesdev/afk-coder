import { Outcome, TokenUsage, AgentError, ExecutionDecision } from '../common/types';

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

    let error = this.classifyError(logs);

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
      delayMs = Math.max(delayMs, 60_000);
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

    const error = this.classifyError(logs);
    return {
      success: false,
      tokens,
      error: error || { type: 'Runtime', message: `Agent exited with code ${exitCode}` }
    };
  }

  private extractTokenUsage(logs: string): TokenUsage {
    const jsonStats = this.parseFullJson(logs) ?? this.parseNdjson(logs);
    if (jsonStats) {
      return jsonStats;
    }
    return this.parseRegexStats(logs);
  }

  private parseFullJson(logs: string): TokenUsage | null {
    const jsonStart = logs.indexOf('{');
    const jsonEnd = logs.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      try {
        const parsed = JSON.parse(logs.slice(jsonStart, jsonEnd + 1));
        return this.extractFromJson(parsed);
      } catch {
        // Fall back to line-by-line check
      }
    }
    return null;
  }

  private parseNdjson(logs: string): TokenUsage | null {
    const lines = logs.split('\n');
    const result = { input: 0, output: 0, total: 0 };
    let hasStats = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          const usage = this.extractFromJson(parsed);
          if (usage) {
            hasStats = true;
            result.input += usage.input;
            result.output += usage.output;
            result.total += usage.total;
          }
        } catch {
          // Ignore invalid lines
        }
      }
    }

    return hasStats ? result : null;
  }

  private extractFromJson(parsed: any): TokenUsage | null {
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    // Check if the structure contains stats (with or without 'type: result')
    const stats = parsed.stats ?? (parsed.type === 'result' ? parsed.stats : null);
    if (stats) {
      return this.extractFromStats(stats);
    }

    // Try extracting flat properties on the root object
    return this.extractFromStats(parsed);
  }

  private extractFromStats(stats: any): TokenUsage | null {
    if (!stats || typeof stats !== 'object') {
      return null;
    }

    const result = { input: 0, output: 0, total: 0 };
    let hasStats = false;

    if (stats.models && typeof stats.models === 'object') {
      for (const modelKey of Object.keys(stats.models)) {
        const model = stats.models[modelKey];
        if (model && typeof model === 'object') {
          // Model tokens might be nested under `model.tokens` or flat on the `model` object itself
          const tokenObj = (model.tokens && typeof model.tokens === 'object') ? model.tokens : model;
          const values = this.extractTokenValues(tokenObj);
          if (values) {
            hasStats = true;
            result.input += values.input;
            result.output += values.output;
            result.total += values.total;
          }
        }
      }
    } else {
      const values = this.extractTokenValues(stats);
      if (values) {
        hasStats = true;
        result.input += values.input;
        result.output += values.output;
        result.total += values.total;
      }
    }

    return hasStats ? result : null;
  }

  private extractTokenValues(obj: any): TokenUsage | null {
    if (!obj || typeof obj !== 'object') {
      return null;
    }

    const parseVal = (val: any): number | undefined => {
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const parsed = Number.parseInt(val, 10);
        return Number.isNaN(parsed) ? undefined : parsed;
      }
      return undefined;
    };

    const input = parseVal(obj.prompt) ?? parseVal(obj.input) ?? parseVal(obj.input_tokens) ?? 0;
    const output = parseVal(obj.candidates) ?? parseVal(obj.output) ?? parseVal(obj.output_tokens) ?? 0;
    const total = parseVal(obj.total) ?? parseVal(obj.total_tokens) ?? (input + output);

    if (input > 0 || output > 0 || total > 0) {
      return { input, output, total };
    }
    return null;
  }

  private parseRegexStats(logs: string): TokenUsage {
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
        const input = Number.parseInt(match[1], 10);
        const output = Number.parseInt(match[2], 10);
        return {
          input,
          output,
          total: input + output
        };
      }
    }

    return { input: 0, output: 0, total: 0 };
  }

  private classifyError(logs: string): AgentError | undefined {
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
