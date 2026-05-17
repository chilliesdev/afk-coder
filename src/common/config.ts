import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
    nanoCpus: 2000000000, // 2 CPUs
  },
  daemon: {
    socketGroup: 'afk-coder-users',
    socketPath: '/tmp/afk-coder.sock',
  },
  auth: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    redirectUri: 'http://localhost:3000',
  },
};


export function ensureConfigDir(configDir?: string) {
  const dir = configDir || CONFIG_DIR;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig(configDir?: string): Config {
  const configPath = configDir ? path.join(configDir, 'config.json') : CONFIG_PATH;
  if (fs.existsSync(configPath)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
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
    }
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: Config, configDir?: string) {
  ensureConfigDir(configDir);
  const configPath = configDir ? path.join(configDir, 'config.json') : CONFIG_PATH;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function saveTokens(tokens: any, configDir?: string) {
  ensureConfigDir(configDir);
  const tokensPath = configDir ? path.join(configDir, 'tokens.json') : TOKENS_PATH;
  fs.writeFileSync(tokensPath, JSON.stringify(tokens, null, 2));
}

export function loadTokens(configDir?: string) {
  const tokensPath = configDir ? path.join(configDir, 'tokens.json') : TOKENS_PATH;
  if (fs.existsSync(tokensPath)) {
    return JSON.parse(fs.readFileSync(tokensPath, 'utf-8'));
  }
  return null;
}

export async function refreshToken(configDir?: string) {
  const tokens = loadTokens(configDir);
  if (!tokens || !tokens.refresh_token) {
    return null;
  }

  const { OAuth2Client } = await import('google-auth-library');
  const config = loadConfig(configDir);
  
  const clientId = process.env.GOOGLE_CLIENT_ID || config.auth?.clientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || config.auth?.clientSecret;

  if (!clientId || !clientSecret) {
    return tokens; // Can't refresh without credentials, return original
  }

  const oAuth2Client = new OAuth2Client(clientId, clientSecret);
  oAuth2Client.setCredentials(tokens);

  try {
    const { credentials } = await oAuth2Client.refreshAccessToken();
    const updatedTokens = { ...tokens, ...credentials };
    saveTokens(updatedTokens, configDir);
    return updatedTokens;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return tokens;
  }
}
