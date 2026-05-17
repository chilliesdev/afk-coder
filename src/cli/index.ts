import { Command } from 'commander';
import { sendCommand } from './client';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { validateWorkflowDir } from '../common/validation';

const program = new Command();

program
  .name('afk-coder')
  .description('Gemini AFK Coding Daemon CLI')
  .version('1.0.0');

program
  .command('init')
  .description('Generate tasks.md from PRD.md')
  .option('--dir <path>', 'Directory containing PRD.md', '.')
  .option('--force', 'Overwrite existing tasks.md')
  .action(async (options) => {
    const { Sandbox } = await import('../sandbox');
    const sandbox = new Sandbox();

    const dir = path.resolve(options.dir);
    const prdPath = path.join(dir, 'PRD.md');
    const tasksPath = path.join(dir, 'tasks.md');

    if (!fs.existsSync(prdPath)) {
      console.error(`Error: PRD.md not found in ${dir}`);
      return;
    }

    if (fs.existsSync(tasksPath) && !options.force) {
      console.error(`Error: tasks.md already exists in ${dir}. Use --force to overwrite.`);
      return;
    }

    console.log(`Generating tasks.md from ${prdPath} using Docker sandbox...`);
    try {
      const prompt = 'gemini --yolo --prompt "Extract all implementation tasks from PRD.md and list them in tasks.md. Format each task as \\"- [ ] Task description\\". Ensure the tasks are granular and actionable. Only output the tasks.md content, no conversational text."';

      const run = await sandbox.run(prompt, dir);
      const result = await run.wait();

      if (result.exitCode === 0) {
        if (fs.existsSync(tasksPath)) {
          console.log('Successfully generated tasks.md');
        } else {
          // If gemini didn't write the file directly (e.g. it just outputted to stdout),
          // we can try to use the logs, but ideally gemini --yolo with that prompt should write it if it's smart enough,
          // OR we can just write it ourselves from logs if it's missing.
          // However, gemini CLI usually writes files if instructed.
          // Let's check if tasks.md was created in the mapped volume.
          if (fs.existsSync(tasksPath)) {
            console.log('Successfully generated tasks.md');
          } else {
            // Fallback: write stdout to tasks.md if it looks like task list
            const lines = result.logs.split('\n').filter(l => l.trim().startsWith('- [ ]'));
            if (lines.length > 0) {
              fs.writeFileSync(tasksPath, lines.join('\n'));
              console.log('Successfully generated tasks.md (from stdout)');
            } else {
              console.error('Failed to generate tasks.md: No tasks found in output');
              console.log('Logs:', result.logs);
            }
          }
        }
      } else {
        console.error(`Failed to generate tasks.md: Exit code ${result.exitCode}`);
        console.error('Logs:', result.logs);
      }
    } catch (err: any) {
      console.error('Failed to generate tasks.md:', err.message);
    }
  });

program
  .command('login')
  .description('Initiate Google OAuth 2.0 flow')
  .action(async () => {
    const { OAuth2Client } = await import('google-auth-library');
    const { saveTokens, loadConfig, saveConfig } = await import('../common/config');
    const http = await import('http');
    const url = await import('url');
    const readline = await import('readline');

    const config = loadConfig();
    const clientId = process.env.GOOGLE_CLIENT_ID || config.auth?.clientId;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.auth?.clientSecret;
    const scopes = config.auth?.scopes || ['https://www.googleapis.com/auth/cloud-platform'];

    if (!clientId || !clientSecret) {
      console.error('Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables must be set (or configured in config.json).');
      console.log('Please create a project in the Google Cloud Console and set these variables.');
      return;
    }

    // Save credentials to config for daemon use if provided via env
    if (process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_SECRET) {
      config.auth = {
        ...config.auth,
        clientId: clientId,
        clientSecret: clientSecret
      };
      saveConfig(config);
    }

    const oAuth2Client = new OAuth2Client({
      clientId,
      clientSecret,
      redirectUri: config.auth?.redirectUri
    });

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
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
      } catch (err: any) {
        console.error('Error retrieving access token:', err.message);
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
        } else if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authentication failed!</h1><p>Error: ${error}</p>`);
          if (!isFinished) {
            isFinished = true;
            rl.close();
            server.close();
          }
        } else {
          // Handle favicon.ico and any other requests by immediately returning 404
          // to prevent the browser from hanging.
          res.writeHead(404);
          res.end();
        }
      } catch (err: any) {
        console.error('Error retrieving access token', err.message);
        res.writeHead(500);
        res.end('Authentication failed.');
        if (!isFinished) {
          isFinished = true;
          rl.close();
          server.close();
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
            }
          }
        } catch (err: any) {
          console.error('Invalid URL or code input:', err.message);
          if (!isFinished) {
            isFinished = true;
            rl.close();
            server.close();
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
      } catch (err: any) {
        console.error(`Validation failed: ${err.message}`);
        return;
      }

      const response = await sendCommand('start', { name: workflowName, dir });
      if (response.success) {
        console.log(`Workflow ${workflowName} started successfully.`);
      } else {
        console.error(`Failed to start workflow: ${response.message}`);
      }
    } catch (err: any) {
      console.error(err.message);
    }
  });

program
  .command('list')
  .description('List running workflows')
  .action(async () => {
    try {
      const response = await sendCommand('list');
      if (response.success) {
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
      } else {
        console.error(`Failed to list workflows: ${response.message}`);
      }
    } catch (err: any) {
      console.error(err.message);
    }
  });

program
  .command('kill <workflow_name>')
  .description('Terminate a workflow')
  .action(async (workflowName) => {
    try {
      const response = await sendCommand('kill', { name: workflowName });
      if (response.success) {
        console.log(`Workflow ${workflowName} killed.`);
      } else {
        console.error(`Failed to kill workflow: ${response.message}`);
      }
    } catch (err: any) {
      console.error(err.message);
    }
  });

program
  .command('remove <workflow_name>')
  .description('Remove a finished or failed workflow from the daemon')
  .action(async (workflowName) => {
    try {
      const response = await sendCommand('remove', { name: workflowName });
      if (response.success) {
        console.log(`Workflow ${workflowName} removed.`);
      } else {
        console.error(`Failed to remove workflow: ${response.message}`);
      }
    } catch (err: any) {
      console.error(err.message);
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
        let currentOffset: number | undefined = undefined;
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
        if (response.success) {
          console.log(response.data.content);
        } else {
          console.error(`Failed to get logs: ${response.message}`);
        }
      }
    } catch (err: any) {
      console.error(err.message);
    }
  });

program.parse();
