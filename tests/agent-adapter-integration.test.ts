import { WorkflowManager, AgentFactory } from '../src/daemon/workflow-manager';
import { Agent } from '../src/daemon/agent';
import { GeminiAdapter } from '../src/daemon/agent-gemini';
import { AiderAdapter } from '../src/daemon/agent-aider';
import { MockRuntime } from './mocks/mock-runtime';
import { OutcomeAnalyzer } from '../src/daemon/agent-outcome';
import { TaskBoard } from '../src/daemon/task-board';
import { InMemoryTaskStorage } from '../src/daemon/task-storage';
import * as fs from 'fs';
import * as path from 'path';

describe('Agent Adapter Integration', () => {
  let mockRuntime: MockRuntime;
  const testDir = path.resolve('./test-adapter-integration');
  
  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'PRD.md'), '# PRD');
    fs.writeFileSync(path.join(testDir, 'tasks.md'), '- [ ] Task 1');
    mockRuntime = new MockRuntime();
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  const createAgentFactory = (defaultAgent: string): AgentFactory => {
    return (agentName?: string) => {
      const name = agentName || defaultAgent;
      let adapter;
      if (name === 'aider') {
        adapter = new AiderAdapter();
      } else {
        adapter = new GeminiAdapter();
      }
      return new Agent(mockRuntime, new OutcomeAnalyzer(), adapter);
    };
  };

  it('should use AiderAdapter when agent name is "aider"', async () => {
    const factory = createAgentFactory('gemini');
    const wm = new WorkflowManager(factory, () => new TaskBoard(new InMemoryTaskStorage('- [ ] Task 1')));
    
    await wm.startWorkflow('aider-wf', testDir, { agent: 'aider' });
    
    // Poll for the prompt to be set
    let attempts = 0;
    while (!mockRuntime.lastPrompt && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    expect(mockRuntime.lastPrompt).toContain('aider --yes --message');
    await wm.killWorkflow('aider-wf');
  });

  it('should use GeminiAdapter when agent name is "gemini"', async () => {
    const factory = createAgentFactory('aider'); // default is aider
    const wm = new WorkflowManager(factory, () => new TaskBoard(new InMemoryTaskStorage('- [ ] Task 1')));
    
    await wm.startWorkflow('gemini-wf', testDir, { agent: 'gemini' });
    
    let attempts = 0;
    while (!mockRuntime.lastPrompt && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    expect(mockRuntime.lastPrompt).toContain('gemini --yolo --output-format json --prompt');
    await wm.killWorkflow('gemini-wf');
  });

  it('should use default agent from factory when no agent flag is provided', async () => {
    const factory = createAgentFactory('aider'); // default is aider
    const wm = new WorkflowManager(factory, () => new TaskBoard(new InMemoryTaskStorage('- [ ] Task 1')));
    
    await wm.startWorkflow('default-wf', testDir);
    
    let attempts = 0;
    while (!mockRuntime.lastPrompt && attempts < 50) {
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }
    
    expect(mockRuntime.lastPrompt).toContain('aider --yes --message');
    await wm.killWorkflow('default-wf');
  });

  it('should use correct adapter in Agent.generateTasks', async () => {
    const factory = createAgentFactory('gemini');
    const agent = factory('aider');
    
    await agent.generateTasks(testDir, 'PRD.md', true);
    
    expect(mockRuntime.lastPrompt).toContain('aider --yes --message');
    expect(mockRuntime.lastPrompt).toContain('Read the PRD.md file');
  });
});
