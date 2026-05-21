import { Command } from 'commander';
import { DaemonClient } from './client';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import { TaskValidator } from '../common/validation';

const client = new DaemonClient();
const validator = new TaskValidator();

const sendCommand = client.sendCommand.bind(client);
const validateWorkflowDir = validator.validateWorkflowDir.bind(validator);

const program = new Command();

program
  .name('afk-coder')
  .description('Gemini AFK Coding Daemon CLI')
  .version('1.0.0');

program
  .command('init')
  .description('Generate tasks.md from a PRD file')
  .option('--dir <path>', 'Directory containing the PRD file', '.')
  .option('--prd <filename>', 'Name of the PRD file', 'PRD.md')
  .option('--force', 'Overwrite existing tasks.md')
  .action(async (options) => {
    try {
      const dir = path.resolve(options.dir);
      const { CONFIG_DIR } = await import('../common/config');

      console.log(`Generating tasks.md from ${options.prd} via Gemini AFK Daemon...`);
      const response = await sendCommand('init', {
        dir,
        prd: options.prd,
        force: options.force,
        configDir: CONFIG_DIR
      });

      if (!response.success) {
        console.error(`Failed to generate tasks.md: ${response.message}`);
        if (response.data) {
          console.log('Logs:', response.data);
        }
        return;
      }
      console.log(response.data || 'Successfully generated tasks.md');
    } catch (error: any) {
      console.error('Failed to generate tasks.md:', error.message);
    }
  });


program
  .command('login')
  .description('Initiate Google OAuth 2.0 flow')
  .action(async () => {
    const { OAuth2Client } = await import('google-auth-library');
    const { ConfigManager } = await import('../common/config');
    const http = await import('node:http');
    const url = await import('node:url');
    const readline = await import('node:readline');

    const configManager = new ConfigManager();
    const saveTokens = configManager.saveTokens.bind(configManager);
    const loadConfig = configManager.loadConfig.bind(configManager);
    const saveConfig = configManager.saveConfig.bind(configManager);

    const config = loadConfig();
    const envClientId = process.env.GOOGLE_CLIENT_ID;
    const envClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    const clientId = envClientId || config.auth?.clientId;
    const clientSecret = envClientSecret || config.auth?.clientSecret;
    const scopes = config.auth?.scopes || ['https://www.googleapis.com/auth/cloud-platform'];

    if (!clientId || !clientSecret) {
      console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set via environment variables or in config.json.');
      console.log('Example: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy afk-coder login');
      return;
    }

    // Save credentials to config if provided via env and they differ from current config
    if ((envClientId || envClientSecret) && (envClientId !== config.auth?.clientId || envClientSecret !== config.auth?.clientSecret)) {
        config.auth = {
          ...config.auth,
          clientId: clientId,
          clientSecret: clientSecret
        };
        saveConfig(config);
        console.log('Updated Google Cloud credentials in config.json');
      }

    const oAuth2Client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri: config.auth?.redirectUri
    });

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
    });

    console.log('Authorize this app by visiting this url:', authUrl);

    let isFinished = false;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const finishLogin = async (code: string) => {
      if (isFinished) return;
      isFinished = true;
      rl.close();
      server.close();

      try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        saveTokens(tokens);
        console.log('Login successful! Tokens saved.');
        process.exit(0);
      } catch (error: any) {
        console.error('Error retrieving access token:', error.message);
        process.exit(1);
      }
    };

    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new url.URL(req.url!, 'http://localhost:3000');
        const code = reqUrl.searchParams.get('code');
        const error = reqUrl.searchParams.get('error');

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>Authentication successful!</h1><p>Please return to the console.</p><script>window.close();</script>');
          await finishLogin(code);
          return;
        }
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication failed!</h1><p>Error: ${error}</p>`);
          if (!isFinished) {
            isFinished = true;
            rl.close();
            server.close();
            process.exit(1);
          }
          return;
        }
        
        // Handle favicon.ico and any other requests by immediately returning 404
        // to prevent the browser from hanging.
        res.writeHead(404);
        res.end();
      } catch (error: any) {
        console.error('Error retrieving access token', error.message);
        res.writeHead(500);
        res.end('Authentication failed.');
        if (!isFinished) {
          isFinished = true;
          rl.close();
          server.close();
          process.exit(1);
        }
      }
    });

    server.on('error', (err: any) => {
      rl.close();
      if (err.code === 'EADDRINUSE') {
        console.error('\n❌ Error: Port 3000 is already in use by another process.');
        console.error('💡 Tip: Free up the port by running "npx kill-port 3000" and try logging in again.');
        process.exit(1);
      } else {
        console.error('\n❌ Local server error:', err.message);
        process.exit(1);
      }
    });

    server.listen(3000, () => {
      console.log('Waiting for authorization...');
      rl.question('\nIf running on a remote server, paste the redirect URL here:\n> ', async (input) => {
        if (isFinished) return;
        const trimmed = input.trim();
        if (!trimmed) {
          if (!isFinished) {
            isFinished = true;
            rl.close();
            server.close();
            process.exit(0);
          }
          return;
        }

        try {
          let code: string | null = null;
          if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
            const parsedUrl = new url.URL(trimmed);
            code = parsedUrl.searchParams.get('code');
          } else if (trimmed.includes('?code=')) {
            const parsedUrl = new url.URL('http://' + trimmed);
            code = parsedUrl.searchParams.get('code');
          } else {
            code = trimmed;
          }

          if (code) {
            await finishLogin(code);
          } else {
            console.error('Could not extract authorization code from input.');
            if (!isFinished) {
              isFinished = true;
              rl.close();
              server.close();
              process.exit(1);
            }
          }
        } catch (error: any) {
          console.error('Invalid URL or code input:', error.message);
          if (!isFinished) {
            isFinished = true;
            rl.close();
            server.close();
            process.exit(1);
          }
        }
      });
    });
  });


program
  .command('start <workflow_name>')
  .description('Start a new workflow')
  .option('--dir <path>', 'Implementation directory')
  .action(async (workflowName, options) => {
    try {
      const dir = path.resolve(options.dir || '.');

      // Validate locally before sending to daemon
      try {
        validateWorkflowDir(dir);
      } catch (error: any) {
        console.error(`Validation failed: ${error.message}`);
        return;
      }

      const { CONFIG_DIR } = await import('../common/config');
      const response = await sendCommand('start', { 
        name: workflowName, 
        dir,
        configDir: CONFIG_DIR
      });
      if (!response.success) {
        console.error(`Failed to start workflow: ${response.message}`);
        return;
      }
      console.log(`Workflow ${workflowName} started successfully.`);
    } catch (error: any) {
      console.error(error.message);
    }
  });

program
  .command('list')
  .description('List running workflows')
  .action(async () => {
    try {
      const response = await sendCommand('list');
      if (!response.success) {
        console.error(`Failed to list workflows: ${response.message}`);
        return;
      }
      
      const formattedData = response.data.map((w: any) => {
        const s = Math.floor(w.uptime / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const rs = s % 60;
        return {
          ...w,
          uptime: `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${rs}s`,
        };
      });
      console.table(formattedData);
    } catch (error: any) {
      console.error(error.message);
    }
  });

program
  .command('status <workflow_name>')
  .description('Show detailed status of a workflow')
  .action(async (workflowName) => {
    try {
      const response = await sendCommand('status', { name: workflowName });
      if (!response.success) {
        console.error(`Failed to get status: ${response.message}`);
        return;
      }

      const w = response.data;
      const s = Math.floor(w.uptime / 1000);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const rs = s % 60;
      const uptimeStr = `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${rs}s`;

      const colors = {
        reset: '\u001B[0m',
        bold: '\u001B[1m',
        green: '\u001B[32m',
        yellow: '\u001B[33m',
        red: '\u001B[31m',
        cyan: '\u001B[36m',
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
      if (!w.recentTasks || w.recentTasks.length === 0) {
        console.log('  None');
        return;
      }
      w.recentTasks.forEach((task: string) => console.log(`  - ${task}`));
      console.log('');
      console.log(`${colors.bold}Token Usage:${colors.reset}`);
      console.log(`  Input:  ${w.tokenUsage.input.toLocaleString()}`);
      console.log(`  Output: ${w.tokenUsage.output.toLocaleString()}`);
      console.log(`  Total:  ${w.tokenUsage.total.toLocaleString()}`);
    } catch (error: any) {
      console.error(error.message);
    }
  });

program
  .command('kill <workflow_name>')
  .description('Terminate a workflow')
  .action(async (workflowName) => {
    try {
      const response = await sendCommand('kill', { name: workflowName });
      if (!response.success) {
        console.error(`Failed to kill workflow: ${response.message}`);
        return;
      }
      console.log(`Workflow ${workflowName} killed.`);
    } catch (error: any) {
      console.error(error.message);
    }
  });

program
  .command('remove <workflow_name>')
  .description('Remove a finished or failed workflow from the daemon')
  .action(async (workflowName) => {
    try {
      const response = await sendCommand('remove', { name: workflowName });
      if (!response.success) {
        console.error(`Failed to remove workflow: ${response.message}`);
        return;
      }
      console.log(`Workflow ${workflowName} removed.`);
    } catch (error: any) {
      console.error(error.message);
    }
  });

program
  .command('logs <workflow_name>')
  .description('View workflow logs')
  .option('-f, --follow', 'Stream logs')
  .option('--tail <lines>', 'Number of lines to show')
  .action(async (workflowName, options) => {
    try {
      if (options.follow) {
        let currentOffset: number | undefined;
        console.log(`Following logs for ${workflowName}... (Ctrl+C to stop)`);

        // Initial fetch with tail
        const initialResponse = await sendCommand('logs', {
          name: workflowName,
          tail: options.tail || 20
        });

        if (initialResponse.success) {
          process.stdout.write(initialResponse.data.content);
          currentOffset = initialResponse.data.nextOffset;
        }

        while (true) {
          const response = await sendCommand('logs', {
            name: workflowName,
            offset: currentOffset
          });
          if (response.success) {
            if (response.data.content) {
              process.stdout.write(response.data.content);
            }
            currentOffset = response.data.nextOffset;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } else {
        const response = await sendCommand('logs', { name: workflowName, tail: options.tail });
        if (!response.success) {
          console.error(`Failed to get logs: ${response.message}`);
          return;
        }
        console.log(response.data.content);
      }
    } catch (error: any) {
      console.error(error.message);
    }
  });

program.parse();
