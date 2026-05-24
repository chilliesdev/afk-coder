import { Agent } from '../src/daemon/agent';
import { MockRuntime } from './mocks/mock-runtime';
import { AiderAdapter } from '../src/daemon/agent-aider';
import { MILESTONE_STATUS, MilestoneEvent } from '../src/common/types';
import * as fs from 'node:fs';

jest.mock('node:fs', () => {
  const actualFs = jest.requireActual('node:fs');
  return {
    ...actualFs,
    existsSync: jest.fn(),
    writeFileSync: jest.fn(),
    readFileSync: jest.fn(),
    unlinkSync: jest.fn(),
  };
});

describe('Agent', () => {
  let agent: Agent;
  let mockRuntime: MockRuntime;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRuntime = new MockRuntime();
    agent = new Agent(mockRuntime);

    (fs.existsSync as jest.Mock).mockImplementation((p: string) => {
        if (p.endsWith('PRD.md')) return true;
        if (p.endsWith('tasks.md')) return false;
        return false;
    });
    (fs.readFileSync as jest.Mock).mockReturnValue('mock tasks');
  });

  it('should run autonomous loop with correct prompt', async () => {
    await agent.runAutonomousLoop('/some/dir');
    expect(mockRuntime.lastPrompt).toContain('gemini --yolo --prompt');
    expect(mockRuntime.lastPrompt).toContain('tasks.md');
    expect(mockRuntime.lastPrompt).toContain('highest priority uncompleted task');
    expect(mockRuntime.lastDir).toBe('/some/dir');
  });

  it('should use AiderAdapter if provided', async () => {
    const aiderAgent = new Agent(mockRuntime, undefined, new AiderAdapter());
    await aiderAgent.runAutonomousLoop('/some/dir');
    expect(mockRuntime.lastPrompt).toContain('aider --yes --message');
    expect(mockRuntime.lastPrompt).toContain('tasks.md');
  });

  describe('generateTasks milestones', () => {
    it('should emit STARTING and COMPLETED milestones for runtime start', async () => {
      const milestones: MilestoneEvent[] = [];
      const onMilestone = (e: MilestoneEvent) => milestones.push(e);

      await agent.generateTasks('/some/dir', 'PRD.md', false, undefined, onMilestone);

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Starting execution runtime...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.COMPLETED,
        message: 'Execution runtime started'
      }));
    });

    it('should emit FAILED milestone if runtime start fails', async () => {
      jest.spyOn(mockRuntime, 'start').mockRejectedValue(new Error('Docker failed'));
      const milestones: MilestoneEvent[] = [];
      const onMilestone = (e: MilestoneEvent) => milestones.push(e);

      await agent.generateTasks('/some/dir', 'PRD.md', false, undefined, onMilestone);

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.STARTING,
        message: 'Starting execution runtime...'
      }));

      expect(milestones).toContainEqual(expect.objectContaining({
        status: MILESTONE_STATUS.FAILED,
        message: 'Failed to start runtime: Docker failed'
      }));
    });
  });
});
