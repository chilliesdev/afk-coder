import { AiderAdapter } from '../../../src/daemon/agent-aider';
import { GeminiAdapter } from '../../../src/daemon/agent-gemini';

describe('Agent Adapters', () => {
  describe('AiderAdapter', () => {
    const adapter = new AiderAdapter();

    it('should return correct commands', () => {
      expect(adapter.getAutonomousLoopCommand()).toContain('aider --yes');
      expect(adapter.getTaskGenerationCommand('test-prd.md')).toContain('aider --yes');
      expect(adapter.getTaskGenerationCommand('test-prd.md')).toContain('test-prd.md');
      expect(adapter.getQALoopCommand()).toContain('aider --yes');
      expect(adapter.getCommitMessageCommand()).toContain('aider --yes');
    });
  });

  describe('GeminiAdapter', () => {
    const adapter = new GeminiAdapter();

    it('should return correct commands', () => {
      expect(adapter.getAutonomousLoopCommand()).toContain('gemini --yolo');
      expect(adapter.getTaskGenerationCommand('test-prd.md')).toContain('gemini --yolo');
      expect(adapter.getTaskGenerationCommand('test-prd.md')).toContain('test-prd.md');
      expect(adapter.getQALoopCommand()).toContain('gemini --yolo');
      expect(adapter.getCommitMessageCommand()).toContain('gemini --yolo');
    });
  });
});
