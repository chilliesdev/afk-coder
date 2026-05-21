import { parseAgentOutput, AgentOutcomeEvaluator } from '../src/daemon/agent-outcome';

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

describe('AgentOutcomeEvaluator', () => {
  let evaluator: AgentOutcomeEvaluator;
  const makeMockTaskBoard = (newlyCompleted: any[] = []): any => ({
    load: jest.fn(),
    reconcile: jest.fn().mockResolvedValue({
      newlyCompleted,
      state: {
        progress: { completed: 0, total: 0, percentage: '0%' },
        pendingTasks: [],
        tasks: []
      }
    }),
    getTasks: jest.fn()
  });

  beforeEach(() => {
    evaluator = new AgentOutcomeEvaluator(3);
  });

  it('should return action next when exit code is 0 and new tasks are completed', async () => {
    const taskBoard = makeMockTaskBoard([{ completed: true, description: 'Task 1' }]);
    const decision = await evaluator.evaluate(
      'Tokens: 100 prompt, 50 completion',
      0,
      0,
      taskBoard
    );
    expect(decision.action).toBe('next');
    expect(decision.delayMs).toBe(5000);
    expect(decision.tokens.input).toBe(100);
    expect(decision.tokens.output).toBe(50);
    expect(decision.error).toBeUndefined();
  });

  it('should return action fail with NoProgress error when exit code is 0 but no tasks are completed', async () => {
    const taskBoard = makeMockTaskBoard([]);
    const decision = await evaluator.evaluate(
      'Tokens: 100 prompt, 50 completion',
      0,
      0,
      taskBoard
    );
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('NoProgress');
    expect(decision.error?.message).toContain('no progress');
  });

  it('should return action fail immediately for Safety errors', async () => {
    const taskBoard = makeMockTaskBoard([]);
    const decision = await evaluator.evaluate(
      'Candidate was blocked due to safety reasons.',
      1,
      0,
      taskBoard
    );
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('Safety');
  });

  it('should return action fail immediately for NoProgress errors in logs', async () => {
    const taskBoard = makeMockTaskBoard([]);
    const decision = await evaluator.evaluate(
      'I am stuck. No progress could be made.',
      1,
      0,
      taskBoard
    );
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('NoProgress');
  });

  it('should retry for Quota errors with minimum 60s wait', async () => {
    const taskBoard = makeMockTaskBoard([]);
    const decision = await evaluator.evaluate(
      'Error: 429 Too Many Requests. Quota exceeded.',
      1,
      0,
      taskBoard
    );
    expect(decision.action).toBe('retry');
    expect(decision.error?.type).toBe('Quota');
    expect(decision.delayMs).toBe(60000);
  });

  it('should calculate exponential backoff for retriable errors', async () => {
    const taskBoard = makeMockTaskBoard([]);
    const d1 = await evaluator.evaluate('Runtime error', 1, 0, taskBoard);
    expect(d1.action).toBe('retry');
    expect(d1.delayMs).toBe(10000);

    const d2 = await evaluator.evaluate('Runtime error', 1, 1, taskBoard);
    expect(d2.action).toBe('retry');
    expect(d2.delayMs).toBe(20000);

    const d3 = await evaluator.evaluate('Runtime error', 1, 2, taskBoard);
    expect(d3.action).toBe('retry');
    expect(d3.delayMs).toBe(40000);
  });

  it('should return action fail when max retries are exceeded', async () => {
    const taskBoard = makeMockTaskBoard([]);
    const decision = await evaluator.evaluate('Runtime error', 1, 3, taskBoard);
    expect(decision.action).toBe('fail');
    expect(decision.error?.type).toBe('Runtime');
  });
});
