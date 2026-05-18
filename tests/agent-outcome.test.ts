import { parseAgentOutput } from '../src/daemon/agent-outcome';

describe('AgentOutcome', () => {
  it('should parse successful execution with token usage', () => {
    const logs = `
Some logs here...
Token usage: 100 prompt, 50 completion
Done!
    `;
    const outcome = parseAgentOutput(logs, 0);
    expect(outcome.success).toBe(true);
    expect(outcome.tokens.input).toBe(100);
    expect(outcome.tokens.output).toBe(50);
    expect(outcome.tokens.total).toBe(150);
    expect(outcome.error).toBeUndefined();
  });

  it('should parse different token usage patterns', () => {
    const patterns = [
      { logs: 'usage: { prompt_tokens: 10, completion_tokens: 20 }', input: 10, output: 20 },
      { logs: '10 prompt tokens, 20 completion tokens', input: 10, output: 20 },
      { logs: 'tokens: 10 in, 20 out', input: 10, output: 20 },
      { logs: 'input: 10, output: 20', input: 10, output: 20 },
      { logs: 'Usage: 10 input, 20 output', input: 10, output: 20 },
      { logs: 'Tokens: 10 prompt, 20 completion', input: 10, output: 20 }
    ];

    patterns.forEach(p => {
      const outcome = parseAgentOutput(p.logs, 0);
      expect(outcome.tokens.input).toBe(p.input);
      expect(outcome.tokens.output).toBe(p.output);
    });
  });

  it('should classify Quota errors', () => {
    const logs = 'Error: 429 Too Many Requests. Quota exceeded.';
    const outcome = parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('Quota');
    expect(outcome.error?.message).toContain('quota exceeded');
  });

  it('should classify Safety errors', () => {
    const logs = 'Candidate was blocked due to safety reasons.';
    const outcome = parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('Safety');
    expect(outcome.error?.message).toContain('safety filters');
  });

  it('should classify NoProgress errors', () => {
    const logs = 'I am stuck and no progress could be made.';
    const outcome = parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('NoProgress');
    expect(outcome.error?.message).toContain('no progress');
  });

  it('should default to Runtime error for unknown failure', () => {
    const logs = 'Some random crash';
    const outcome = parseAgentOutput(logs, 127);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('Runtime');
    expect(outcome.error?.message).toBe('Agent exited with code 127');
  });

  it('should still extract tokens even on failure', () => {
    const logs = 'Error: 429 Too Many Requests. Usage: 10 prompt, 20 completion';
    const outcome = parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.tokens.total).toBe(30);
    expect(outcome.error?.type).toBe('Quota');
  });
});
