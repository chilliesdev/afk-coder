import { Command } from 'commander';
import { BaseCommand } from './base';

export class LoginCommand extends BaseCommand {
  register(program: Command): void {
    program
      .command('login')
      .description('Initiate Google OAuth 2.0 flow')
      .action(async () => {
        await this.execute();
      });
  }

  async execute(): Promise<void> {
    const { OAuth2Client } = await import('google-auth-library');
    const { ConfigManager } = await import('../../common/config');
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
      console.log('Example: GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy afk login');
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

        const htmlTemplate = (title: string, message: string, script: string = '') => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f3f4f6; color: #1f2937; }
    main { background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); text-align: center; max-width: 400px; width: 90%; }
    h1 { font-size: 1.5rem; margin-bottom: 1rem; color: #111827; }
    p { margin-bottom: 1.5rem; color: #4b5563; }
    .btn { display: inline-block; padding: 0.5rem 1rem; background-color: #3b82f6; color: white; border: none; border-radius: 4px; font-size: 1rem; cursor: pointer; text-decoration: none; }
    .btn:hover { background-color: #2563eb; }
  </style>
</head>
<body>
  <main>
    <h1>${title}</h1>
    <p>${message}</p>
    ${script}
  </main>
</body>
</html>`;

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(htmlTemplate(
            'Authentication Successful',
            'You have successfully authenticated with Google. You can now close this window and return to your terminal.',
            '<button class="btn" onclick="window.close()" aria-label="Close window">Close Window</button><script>setTimeout(() => window.close(), 3000);</script>'
          ));
          await finishLogin(code);
          return;
        }
        
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(htmlTemplate(
            'Authentication Failed',
            `An error occurred during authentication: <strong>${error}</strong>. Please check your console for details.`,
            '<button class="btn" onclick="window.close()" aria-label="Close window">Close Window</button>'
          ));
          if (!isFinished) {
            isFinished = true;
            rl.close();
            server.close();
            process.exit(1);
          }
          return;
        }
        
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
  }
}
