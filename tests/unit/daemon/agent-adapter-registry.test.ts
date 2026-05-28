import { AgentAdapterRegistry, AgentAdapter } from '../../../src/daemon/agent-adapter';

class DummyAdapter implements AgentAdapter {
  getAutonomousLoopCommand(): string { return 'dummy-loop'; }
  getTaskGenerationCommand(prd: string): string { return `dummy-gen-${prd}`; }
  getQALoopCommand(): string { return 'dummy-qa'; }
  getCommitMessageCommand(): string { return 'dummy-commit'; }
}

describe('AgentAdapterRegistry', () => {
  it('should register and retrieve an adapter', () => {
    AgentAdapterRegistry.register('dummy', DummyAdapter);
    expect(AgentAdapterRegistry.has('dummy')).toBe(true);
    
    const adapter = AgentAdapterRegistry.get('dummy');
    expect(adapter).toBeInstanceOf(DummyAdapter);
    expect(adapter.getAutonomousLoopCommand()).toBe('dummy-loop');
  });

  it('should throw an error when retrieving an unregistered adapter', () => {
    expect(AgentAdapterRegistry.has('non-existent')).toBe(false);
    expect(() => AgentAdapterRegistry.get('non-existent')).toThrow(
      'Agent adapter "non-existent" is not registered.'
    );
  });
});
