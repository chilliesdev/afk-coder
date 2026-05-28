import { OutcomeAnalyzer } from '../../../src/daemon/agent-outcome';

describe('AgentOutcome', () => {
  let analyzer: OutcomeAnalyzer;

  beforeEach(() => {
    analyzer = new OutcomeAnalyzer(3);
  });
  it('should parse successful execution with token usage', () => {
    const logs = `
Some logs here...
Token usage: 100 prompt, 50 completion
Done!
    `;
    const outcome = analyzer.parseAgentOutput(logs, 0);
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
      { logs: 'Tokens: 10 prompt, 20 completion', input: 10, output: 20 },
      {
        logs: JSON.stringify({
          session_id: 'test',
          response: 'hello',
          stats: {
            models: {
              'gemini-3.5-flash': {
                tokens: {
                  prompt: 10,
                  candidates: 20
                }
              }
            }
          }
        }),
        input: 10,
        output: 20
      },
      {
        logs: `Warning: terminal dumb\n{"type":"init"}\n{"type":"result","stats":{"models":{"gemini-3.5-flash":{"input_tokens":10,"output_tokens":20}}}}`,
        input: 10,
        output: 20
      }
    ];

    patterns.forEach(p => {
      const outcome = analyzer.parseAgentOutput(p.logs, 0);
      expect(outcome.tokens.input).toBe(p.input);
      expect(outcome.tokens.output).toBe(p.output);
    });
  });

  it('should classify Quota errors', () => {
    const logs = 'Error: 429 Too Many Requests. Quota exceeded.';
    const outcome = analyzer.parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('Quota');
    expect(outcome.error?.message).toContain('quota exceeded');
  });

  it('should classify Safety errors', () => {
    const logs = 'Candidate was blocked due to safety reasons.';
    const outcome = analyzer.parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('Safety');
    expect(outcome.error?.message).toContain('safety filters');
  });

  it('should classify NoProgress errors', () => {
    const logs = 'I am stuck and no progress could be made.';
    const outcome = analyzer.parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('NoProgress');
    expect(outcome.error?.message).toContain('no progress');
  });

  it('should default to Runtime error for unknown failure', () => {
    const logs = 'Some random crash';
    const outcome = analyzer.parseAgentOutput(logs, 127);
    expect(outcome.success).toBe(false);
    expect(outcome.error?.type).toBe('Runtime');
    expect(outcome.error?.message).toBe('Agent exited with code 127');
  });

  it('should still extract tokens even on failure', () => {
    const logs = 'Error: 429 Too Many Requests. Usage: 10 prompt, 20 completion';
    const outcome = analyzer.parseAgentOutput(logs, 1);
    expect(outcome.success).toBe(false);
    expect(outcome.tokens.total).toBe(30);
    expect(outcome.error?.type).toBe('Quota');
  });

  describe('helper methods', () => {
    it('should extract values using extractTokenValues', () => {
      const res = (analyzer as any).extractTokenValues({ prompt: 10, candidates: 20 });
      expect(res).toEqual({ input: 10, output: 20, total: 30 });

      const resString = (analyzer as any).extractTokenValues({ prompt: '10', candidates: '20' });
      expect(resString).toEqual({ input: 10, output: 20, total: 30 });

      const resInvalid = (analyzer as any).extractTokenValues({ prompt: 'not a number' });
      expect(resInvalid).toBeNull();
    });

    it('should extract stats from nested and flat objects using extractFromStats', () => {
      const nestedStats = {
        models: {
          'gemini-3.5-flash': {
            tokens: { prompt: 15, candidates: 25 }
          }
        }
      };
      expect((analyzer as any).extractFromStats(nestedStats)).toEqual({ input: 15, output: 25, total: 40 });

      const flatStats = {
        models: {
          'gemini-3.5-flash': { prompt: 15, candidates: 25 }
        }
      };
      expect((analyzer as any).extractFromStats(flatStats)).toEqual({ input: 15, output: 25, total: 40 });

      const rootStats = { prompt: 15, candidates: 25 };
      expect((analyzer as any).extractFromStats(rootStats)).toEqual({ input: 15, output: 25, total: 40 });
    });

    it('should parse JSON stats using parseFullJson', () => {
      const logs = 'prefix {"stats": {"models": {"gemini": {"tokens": {"prompt": 5, "candidates": 10}}}}} suffix';
      expect((analyzer as any).parseFullJson(logs)).toEqual({ input: 5, output: 10, total: 15 });

      expect((analyzer as any).parseFullJson('invalid { json')).toBeNull();
    });

    it('should parse NDJSON using parseNdjson', () => {
      const logs = 'line 1\n{"type":"result","stats":{"prompt": 5, "candidates": 10}}\nline 3';
      expect((analyzer as any).parseNdjson(logs)).toEqual({ input: 5, output: 10, total: 15 });
    });

    it('should parse regex stats using parseRegexStats', () => {
      expect((analyzer as any).parseRegexStats('Token usage: 100 prompt, 50 completion')).toEqual({
        input: 100,
        output: 50,
        total: 150
      });
    });
  });
});

describe('OutcomeAnalyzer', () => {
  let analyzer: OutcomeAnalyzer;

  beforeEach(() => {
    analyzer = new OutcomeAnalyzer(3);
  });

  it('should return action next when exit code is 0 and new tasks are completed', () => {
    const decision = analyzer.analyze(
      'Tokens: 100 prompt, 50 completion',
      0,
      0,
      1
    );
    expect(decision.action).toBe('next');
    expect(decision.delayMs).toBe(5000);
    expect(decision.tokens.input).toBe(100);
    expect(decision.tokens.output).toBe(50);
    expect(decision.error).toBeUndefined();
  });

  it('should return action fail with NoProgress error when exit code is 0 but no tasks are completed', () => {
    const decision = analyzer.analyze(
      'Tokens: 100 prompt, 50 completion',
      0,
      0,
      0
    );
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('NoProgress');
    expect(decision.error?.message).toContain('no progress');
  });

  it('should return action fail immediately for Safety errors', () => {
    const decision = analyzer.analyze(
      'Candidate was blocked due to safety reasons.',
      1,
      0,
      0
    );
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('Safety');
  });

  it('should return action fail immediately for NoProgress errors in logs', () => {
    const decision = analyzer.analyze(
      'I am stuck. No progress could be made.',
      1,
      0,
      0
    );
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('NoProgress');
  });

  it('should retry for Quota errors with minimum 60s wait', () => {
    const decision = analyzer.analyze(
      'Error: 429 Too Many Requests. Quota exceeded.',
      1,
      0,
      0
    );
    expect(decision.action).toBe('retry');
    expect(decision.error?.type).toBe('Quota');
    expect(decision.delayMs).toBe(60000);
  });

  it('should calculate exponential backoff for retriable errors', () => {
    const d1 = analyzer.analyze('Runtime error', 1, 0, 0);
    expect(d1.action).toBe('retry');
    expect(d1.delayMs).toBe(10000);

    const d2 = analyzer.analyze('Runtime error', 1, 1, 0);
    expect(d2.action).toBe('retry');
    expect(d2.delayMs).toBe(20000);

    const d3 = analyzer.analyze('Runtime error', 1, 2, 0);
    expect(d3.action).toBe('retry');
    expect(d3.delayMs).toBe(40000);
  });

  it('should return action fail when max retries are exceeded', () => {
    const decision = analyzer.analyze('Runtime error', 1, 3, 0);
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('Runtime');
  });
});
