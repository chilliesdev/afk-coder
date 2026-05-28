import { Command } from 'commander';
import { DaemonClient } from '../../../../src/cli/client';
import { Spinner } from '../../../../src/cli/ui';
import { MILESTONE_STATUS, MILESTONE_TYPE } from '../../../../src/common/types';
import * as path from 'node:path';

// Mock DaemonClient
jest.mock('../../../../src/cli/client');
// Mock Spinner
jest.mock('../../../../src/cli/ui');

describe('init command progress feedback', () => {
  let mockSendCommand: jest.Mock;
  let mockSpinner: any;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSendCommand = jest.fn();
    (DaemonClient as jest.Mock).mockImplementation(() => ({
      sendCommand: mockSendCommand
    }));

    mockSpinner = {
      start: jest.fn(),
      update: jest.fn(),
      stop: jest.fn(),
    };
    (Spinner as jest.Mock).mockImplementation(() => mockSpinner);
  });

  it('should handle milestones and update spinner', async () => {
    const { DaemonClient: MockClient } = require('../../../../src/cli/client');
    const { InitCommand } = require('../../../../src/cli/commands/init');
    
    const client = new MockClient();
    const initCommand = new InitCommand({
      client,
      validator: { validateWorkflowDir: jest.fn() }
    });

    mockSendCommand.mockImplementation(async (cmd, args, onMilestone) => {
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.INFO, message: 'Working...' });
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.COMPLETED, message: 'Done!' });
      return { success: true };
    });

    await initCommand.execute({ dir: '.', prd: 'PRD.md', force: false });

    expect(mockSpinner.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinner.update).toHaveBeenCalledWith('Working...');
    expect(mockSpinner.stop).toHaveBeenCalledWith('Done!', true);
  });

  it('should handle failure milestone', async () => {
    const { DaemonClient: MockClient } = require('../../../../src/cli/client');
    const { InitCommand } = require('../../../../src/cli/commands/init');

    const client = new MockClient();
    const initCommand = new InitCommand({
      client,
      validator: { validateWorkflowDir: jest.fn() }
    });

    mockSendCommand.mockImplementation(async (cmd, args, onMilestone) => {
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.FAILED, message: 'Failed!' });
      return { success: false, message: 'Failed!' };
    });

    await initCommand.execute({ dir: '.', prd: 'PRD.md', force: false });

    expect(mockSpinner.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinner.stop).toHaveBeenCalledWith('Failed!', false);
  });
});
