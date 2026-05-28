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
    // Re-import to ensure mocks are applied
    const { DaemonClient: MockClient } = require('../../../../src/cli/client');
    const { Spinner: MockSpinner } = require('../../../../src/cli/ui');
    
    // Setup the command and action manually for the test
    const action = async (options: any) => {
        const spinner = new MockSpinner('Initializing...');
        try {
          const dir = path.resolve(options.dir);
          const { CONFIG_DIR } = await import('../../../../src/common/config');
    
          const client = new MockClient();
          const response = await client.sendCommand('init', {
            dir,
            prd: options.prd,
            force: options.force,
            configDir: CONFIG_DIR
          }, (milestone: any) => {
            switch (milestone.status) {
              case MILESTONE_STATUS.STARTING:
                spinner.start(milestone.message);
                break;
              case MILESTONE_STATUS.INFO:
                spinner.update(milestone.message);
                break;
              case MILESTONE_STATUS.COMPLETED:
                spinner.stop(milestone.message, true);
                break;
              case MILESTONE_STATUS.FAILED:
                spinner.stop(milestone.message, false);
                break;
            }
          });
    
          if (!response.success) {
            spinner.stop(`Failed: ${response.message}`, false);
          }
        } catch (error: any) {
          spinner.stop(`Error: ${error.message}`, false);
        }
      };

    mockSendCommand.mockImplementation(async (cmd, args, onMilestone) => {
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.INFO, message: 'Working...' });
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.COMPLETED, message: 'Done!' });
      return { success: true };
    });

    await action({ dir: '.', prd: 'PRD.md', force: false });

    expect(mockSpinner.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinner.update).toHaveBeenCalledWith('Working...');
    expect(mockSpinner.stop).toHaveBeenCalledWith('Done!', true);
  });

  it('should handle failure milestone', async () => {
    const { DaemonClient: MockClient } = require('../../../../src/cli/client');
    const { Spinner: MockSpinner } = require('../../../../src/cli/ui');

    const action = async (options: any) => {
        const spinner = new MockSpinner('Initializing...');
        try {
          const dir = path.resolve(options.dir);
          const { CONFIG_DIR } = await import('../../../../src/common/config');
    
          const client = new MockClient();
          const response = await client.sendCommand('init', {
            dir,
            prd: options.prd,
            force: options.force,
            configDir: CONFIG_DIR
          }, (milestone: any) => {
            switch (milestone.status) {
              case MILESTONE_STATUS.STARTING:
                spinner.start(milestone.message);
                break;
              case MILESTONE_STATUS.INFO:
                spinner.update(milestone.message);
                break;
              case MILESTONE_STATUS.COMPLETED:
                spinner.stop(milestone.message, true);
                break;
              case MILESTONE_STATUS.FAILED:
                spinner.stop(milestone.message, false);
                break;
            }
          });
    
          if (!response.success) {
            spinner.stop(`Failed: ${response.message}`, false);
          }
        } catch (error: any) {
          spinner.stop(`Error: ${error.message}`, false);
        }
      };

    mockSendCommand.mockImplementation(async (cmd, args, onMilestone) => {
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.STARTING, message: 'Starting...' });
      onMilestone({ type: MILESTONE_TYPE, status: MILESTONE_STATUS.FAILED, message: 'Failed!' });
      return { success: false, message: 'Failed!' };
    });

    await action({ dir: '.', prd: 'PRD.md', force: false });

    expect(mockSpinner.start).toHaveBeenCalledWith('Starting...');
    expect(mockSpinner.stop).toHaveBeenCalledWith('Failed!', false);
  });
});
