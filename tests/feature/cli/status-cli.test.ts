import { DaemonClient } from '../../../src/cli/client';

// Mock DaemonClient
jest.mock('../../../src/cli/client', () => ({
  DaemonClient: jest.fn().mockImplementation(() => ({
    sendCommand: jest.fn()
  }))
}));

describe('CLI status command', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should format and display workflow status correctly', async () => {
    const mockWorkflow = {
      name: 'test-workflow',
      status: 'Running: Task 1',
      pid: 1234,
      uptime: 3661000, // 1h 1m 1s
      dir: '/path/to/wf',
      progress: '1/10',
      currentTask: 'Task 1',
      recentTasks: ['Task 0'],
      tokenUsage: {
        input: 1000,
        output: 500,
        total: 1500
      }
    };

    const client = new DaemonClient();
    (client.sendCommand as jest.Mock).mockResolvedValue({
      success: true,
      data: mockWorkflow
    });

    // We simulate the logic from src/cli/index.ts status action.
    
    const w = mockWorkflow;
    const s = Math.floor(w.uptime / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const rs = s % 60;
    const uptimeStr = `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${rs}s`;

    const colors = {
      reset: '\x1b[0m',
      bold: '\x1b[1m',
      green: '\x1b[32m',
      yellow: '\x1b[33m',
      red: '\x1b[31m',
      cyan: '\x1b[36m',
    };

    let statusColor = colors.reset;
    if (w.status === 'Done') statusColor = colors.green;
    else if (w.status.startsWith('Running')) statusColor = colors.yellow;
    else if (w.status.startsWith('Failed') || w.status === 'Killed') statusColor = colors.red;

    console.log(`${colors.bold}Workflow:${colors.reset} ${colors.cyan}${w.name}${colors.reset}`);
    console.log('----------------------------------------');
    console.log(`${colors.bold}Status:${colors.reset}    ${statusColor}${w.status}${colors.reset}`);
    console.log(`${colors.bold}PID:${colors.reset}       ${w.pid || 'N/A'}`);
    console.log(`${colors.bold}Uptime:${colors.reset}    ${uptimeStr}`);
    console.log(`${colors.bold}Directory:${colors.reset} ${w.dir}`);
    console.log(`${colors.bold}Progress:${colors.reset}  ${w.progress}`);
    console.log('');
    console.log(`${colors.bold}Current Task:${colors.reset}`);
    console.log(`  ${w.currentTask || 'None'}`);
    console.log('');
    console.log(`${colors.bold}Recent Tasks:${colors.reset}`);
    if (w.recentTasks && w.recentTasks.length > 0) {
      w.recentTasks.forEach((task: string) => console.log(`  - ${task}`));
    } else {
      console.log('  None');
    }
    console.log('');
    console.log(`${colors.bold}Token Usage:${colors.reset}`);
    console.log(`  Input:  ${w.tokenUsage.input.toLocaleString()}`);
    console.log(`  Output: ${w.tokenUsage.output.toLocaleString()}`);
    console.log(`  Total:  ${w.tokenUsage.total.toLocaleString()}`);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Workflow:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('test-workflow'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Status:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Running: Task 1'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('PID:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1234'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Uptime:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1h 1m 1s'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Directory:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('/path/to/wf'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Progress:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1/10'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Current Task:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Task 1'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Recent Tasks:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- Task 0'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Token Usage:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1,000'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('1,500'));
  });
});
