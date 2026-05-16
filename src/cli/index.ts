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
  .option('--gemini-path <path>', 'Path to gemini executable')
  .action(async (options) => {
    const { loadConfig } = await import('../common/config');
    const config = loadConfig();
    const geminiPath = options.geminiPath || config.geminiPath || 'gemini';
    
    const dir = path.resolve(options.dir);
    const prdPath = path.join(dir, 'PRD.md');
    const tasksPath = path.join(dir, 'tasks.md');

    if (!fs.existsSync(prdPath)) {
      console.error(`Error: PRD.md not found in ${dir}`);
      return;
    }

    console.log(`Generating tasks.md from ${prdPath}... using ${geminiPath}`);
    try {
      // Check if gemini is in PATH
      try {
        execSync(`${geminiPath} --version`, { stdio: 'ignore' });
      } catch (e) {
        console.error(`Error: "${geminiPath}" executable not found. Please install Gemini CLI or provide correct path.`);
        return;
      }

      const prompt = 'Extract all implementation tasks from PRD.md and list them in tasks.md. Format each task as "- [ ] Task description". Ensure the tasks are granular and actionable. Only output the tasks.md content, no conversational text.';
      const output = execSync(`${geminiPath} --yolo --prompt '${prompt}'`, { cwd: dir, encoding: 'utf8' });
      
      if (fs.existsSync(tasksPath)) {
        console.log('Successfully generated tasks.md');
      } else {
        fs.writeFileSync(tasksPath, output.trim());
        console.log('Successfully generated tasks.md (from stdout)');
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

    const oAuth2Client = new OAuth2Client(
      clientId,
      clientSecret,
      'http://localhost:3000'
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
    });

    console.log('Authorize this app by visiting this url:', authUrl);

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url!.indexOf('/?code=') !== -1) {
          const qs = new url.URL(req.url!, 'http://localhost:3000').searchParams;
          const code = qs.get('code');
          res.end('Authentication successful! Please return to the console.');
          server.close();

          if (code) {
            const { tokens } = await oAuth2Client.getToken(code);
            oAuth2Client.setCredentials(tokens);
            saveTokens(tokens);
            console.log('Login successful! Tokens saved.');
          }
        }
      } catch (err: any) {
        console.error('Error retrieving access token', err.message);
        res.end('Authentication failed.');
        server.close();
      }
    }).listen(3000);

    console.log('Waiting for authorization...');
  });


program
  .command('start <workflow_name>')
  .description('Start a new workflow')
  .option('--dir <path>', 'Implementation directory')
  .action(async (workflowName, options) => {
    try {
      const dir = options.dir ? path.resolve(options.dir) : path.resolve(`./${workflowName}_impl`);
      
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
