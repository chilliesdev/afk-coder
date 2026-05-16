import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const CONFIG_DIR = path.join(os.homedir(), '.config', 'af-coder');
export const TOKENS_PATH = path.join(CONFIG_DIR, 'tokens.json');
export const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

export interface Config {
  sandbox: {
    image: string;
    memory: number;
    nanoCpus: number;
  };
  auth?: {
    clientId: string;
    clientSecret: string;
    scopes?: string[];
  };
  geminiPath?: string;
}

const DEFAULT_CONFIG: Config = {
  sandbox: {
    image: 'us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0',
    memory: 2 * 1024 * 1024 * 1024, // 2GB
    nanoCpus: 2000000000, // 2 CPUs
  },
  auth: {
    clientId: '',
    clientSecret: '',
    scopes: ['https://www.googleapis.com/auth/cloud-platform'],
  },
  geminiPath: 'gemini',
};

export function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): Config {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
      return {
        ...DEFAULT_CONFIG,
        ...userConfig,
        sandbox: {
          ...DEFAULT_CONFIG.sandbox,
          ...userConfig.sandbox,
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

export function saveConfig(config: Config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function saveTokens(tokens: any) {
  ensureConfigDir();
  fs.writeFileSync(TOKENS_PATH, JSON.stringify(tokens, null, 2));
}

export function loadTokens() {
  if (fs.existsSync(TOKENS_PATH)) {
    return JSON.parse(fs.readFileSync(TOKENS_PATH, 'utf-8'));
  }
  return null;
}

export async function refreshToken() {
  const tokens = loadTokens();
  if (!tokens || !tokens.refresh_token) {
    return null;
  }

  const { OAuth2Client } = await import('google-auth-library');
  const config = loadConfig();
  
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
    saveTokens(updatedTokens);
    return updatedTokens;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return tokens;
  }
}
