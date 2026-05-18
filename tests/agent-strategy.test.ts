import { AgentStrategy } from '../src/daemon/agent-strategy';

describe('AgentStrategy', () => {
  let strategy: AgentStrategy;

  beforeEach(() => {
    strategy = new AgentStrategy();
  });

  it('should return the autonomous loop prompt', () => {
    const prompt = strategy.getAutonomousLoopPrompt();
    expect(prompt).toContain('gemini --yolo --prompt');
    expect(prompt).toContain('tasks.md');
    expect(prompt).toContain('highest priority uncompleted task');
  });

  it('should return the task generation prompt', () => {
    const prompt = strategy.getTaskGenerationPrompt();
    expect(prompt).toContain('gemini --yolo --prompt');
    expect(prompt).toContain('PRD.md');
    expect(prompt).toContain('tasks.md');
  });
});
