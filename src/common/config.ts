import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import 'dotenv/config';

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'afk-coder');
export const TOKENS_PATH = path.join(CONFIG_DIR, 'tokens.json');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  sandbox: {
    image: string;
    memory: number;
    nanoCpus: number;
  };
  daemon?: {
    socketGroup?: string;
    socketPath?: string;
    agent?: string;
  };
  auth?: {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
    redirectUri?: string;
  };
}

const DEFAULT_CONFIG: Config = {
  sandbox: {
    image: 'us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0',
    memory: 2 * 1024 * 1024 * 1024, // 2GB
    nanoCpus: 2_000_000_000, // 2 CPUs
  },
  daemon: {
    socketGroup: 'afk-coder-users',
    socketPath: '/tmp/afk-coder.sock',
    agent: 'gemini',
  },
  auth: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    redirectUri: 'http://localhost:3000',
  },
};


export class ConfigManager {
  private readonly configDir: string;
  private readonly tokensPath: string;
  private readonly configPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir || CONFIG_DIR;
    this.tokensPath = path.join(this.configDir, 'tokens.json');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  loadConfig(): Config {
    if (!fs.existsSync(this.configPath)) {
      return DEFAULT_CONFIG;
    }
    try {
      const userConfig = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
      return {
        ...DEFAULT_CONFIG,
        ...userConfig,
        sandbox: {
          ...DEFAULT_CONFIG.sandbox,
          ...userConfig.sandbox,
        },
        daemon: {
          ...DEFAULT_CONFIG.daemon,
          ...userConfig.daemon,
        },
        auth: {
          ...DEFAULT_CONFIG.auth,
          ...userConfig.auth,
        },
      } as Config;
    } catch (error) {
      console.error('Error loading config, using defaults:', error);
      return DEFAULT_CONFIG;
    }
  }

  saveConfig(config: Config): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  saveTokens(tokens: any): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.tokensPath, JSON.stringify(tokens, null, 2));
  }

  loadTokens(): any {
    if (!fs.existsSync(this.tokensPath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(this.tokensPath, 'utf8'));
  }

  async refreshToken(): Promise<any> {
    const tokens = this.loadTokens();
    if (!tokens || !tokens.refresh_token) {
      return null;
    }

    const { OAuth2Client } = await import('google-auth-library');
    const config = this.loadConfig();
    
    const clientId = process.env.GOOGLE_CLIENT_ID || config.auth?.clientId;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.auth?.clientSecret;

    if (!clientId || !clientSecret) {
      return tokens;
    }

    const oAuth2Client = new OAuth2Client(clientId, clientSecret);
    oAuth2Client.setCredentials(tokens);

    try {
      const { credentials } = await oAuth2Client.refreshAccessToken();
      const updatedTokens = { ...tokens, ...credentials };
      this.saveTokens(updatedTokens);
      return updatedTokens;
    } catch (error) {
      console.error('Error refreshing access token:', error);
      return tokens;
    }
  }
}
