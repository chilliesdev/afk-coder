import { MILESTONE_STATUS, MILESTONE_TYPE } from '../src/common/types';
import * as path from 'node:path';

// Define mocks outside so we have a handle to them
const mockSendCommand = jest.fn();
const mockSpinnerInstance = {
  start: jest.fn(),
  update: jest.fn(),
  stop: jest.fn(),
};

// Mock DaemonClient
jest.mock('../src/cli/client', () => {
  return {
    DaemonClient: jest.fn().mockImplementation(() => ({
      sendCommand: mockSendCommand
    }))
  };
});

// Mock Spinner
jest.mock('../src/cli/ui', () => {
  return {
    Spinner: jest.fn().mockImplementation(() => mockSpinnerInstance)
  };
});

// Now import program - it will use the mocks defined above
import { program } from '../src/cli/index';

describe('init command integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default success response
    mockSendCommand.mockResolvedValue({ success: true });
  });

  it('should handle milestones and update spinner via the real CLI action', async () => {
    mockSendCommand.mockImplementation(async (cmd: string, args: any, onMilestone?: Function) => {
      if (onMilestone) {
        onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
        onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.INFO, message: 'Working...' });
        onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.COMPLETED, message: 'Done!' });
      }
      return { success: true };
    });

    await program.parseAsync(['node', 'afk-coder', 'init', '--dir', '.', '--prd', 'PRD.md']);

    expect(mockSendCommand).toHaveBeenCalledWith(
      'init',
      expect.objectContaining({
        dir: path.resolve('.'),
        prd: 'PRD.md',
      }),
      expect.any(Function)
    );

    expect(mockSpinnerInstance.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinnerInstance.update).toHaveBeenCalledWith('Working...');
    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith('Done!', true);
  });

  it('should handle failure milestone in the real CLI action', async () => {
    mockSendCommand.mockImplementation(async (cmd: string, args: any, onMilestone?: Function) => {
      if (onMilestone) {
        onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
        onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.FAILED, message: 'Failed!' });
      }
      return { success: false, message: 'Failed!' };
    });

    await program.parseAsync(['node', 'afk-coder', 'init']);

    expect(mockSpinnerInstance.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith('Failed!', false);
  });

  it('should handle errors thrown during sendCommand', async () => {
    mockSendCommand.mockRejectedValue(new Error('Network error'));

    await program.parseAsync(['node', 'afk-coder', 'init']);

    expect(mockSpinnerInstance.stop).toHaveBeenCalledWith('Error: Network error', false);
  });
});
