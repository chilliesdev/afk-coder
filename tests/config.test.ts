import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  ConfigManager, 
  CONFIG_DIR, 
  CONFIG_PATH, 
  TOKENS_PATH 
} from '../src/common/config';

jest.mock('fs');

describe('Config Management', () => {
  const mockConfig = {
    sandbox: {
      image: 'test-image',
      memory: 1024,
      nanoCpus: 1000000000,
    },
    daemon: {
      socketGroup: 'custom-group',
    },
    auth: {
      clientId: 'test-client-id',
      clientSecret: 'test-client-secret',
      scopes: ['test-scope'],
    },
  };

  const mockTokens = {
    access_token: 'test-access',
    refresh_token: 'test-refresh',
  };

  let manager: ConfigManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new ConfigManager();
  });

  describe('loadConfig', () => {
    it('should return default config if config file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const config = manager.loadConfig();
      expect(config.sandbox.image).toContain('gemini-cli/sandbox');
      expect(config.daemon?.socketGroup).toBe('afk-coder-users');
      expect(config.daemon?.agent).toBe('gemini');
      expect(config.daemon?.logLevel).toBe('info');
    });

    it('should return merged config if config file exists', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p) => p === CONFIG_PATH);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify({
        ...mockConfig,
        daemon: {
          ...mockConfig.daemon,
          agent: 'aider',
          logLevel: 'debug'
        }
      }));
      const config = manager.loadConfig();
      expect(config.sandbox.image).toBe('test-image');
      expect(config.daemon?.socketGroup).toBe('custom-group');
      expect(config.daemon?.agent).toBe('aider');
      expect(config.daemon?.logLevel).toBe('debug');
      expect(config.auth?.clientId).toBe('test-client-id');
    });


    it('should handle JSON parse errors by returning defaults', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid-json');
      // Supress console.error
      jest.spyOn(console, 'error').mockImplementation(() => {});
      const config = manager.loadConfig();
      expect(config.sandbox.image).toContain('gemini-cli/sandbox');
      (console.error as jest.Mock).mockRestore();
    });

  });

  describe('saveConfig', () => {
    it('should create directory if it does not exist and write file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      manager.saveConfig(mockConfig as any);
      expect(fs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        CONFIG_PATH, 
        expect.stringContaining('"image": "test-image"')
      );
    });
  });


  describe('refreshToken extra', () => {
    it('should return null if no tokens', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const result = await manager.refreshToken();
      expect(result).toBeNull();
    });

    it('should return null if tokens file missing refresh_token', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
        if (typeof p === 'string') return p.includes('tokens.json');
        return false;
      });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ access_token: 'test-rt' }));
      const result = await manager.refreshToken();
      expect(result).toBeNull();
    });

    it('should return original if no client creds', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
        if (typeof p === 'string') return p.includes('tokens.json');
        return false;
      });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ refresh_token: 'test-rt' }));
      delete process.env.GOOGLE_CLIENT_ID;
      delete process.env.GOOGLE_CLIENT_SECRET;

      const result = await manager.refreshToken();
      expect(result).toEqual({ refresh_token: 'test-rt' });
    });

    it('should test missing original return logic', async () => {
      jest.spyOn(fs, 'existsSync').mockImplementation((p: any) => {
        if (typeof p === 'string') return p.includes('tokens.json');
        return false;
      });
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ refresh_token: 'test-rt' }));

      // clientId only
      process.env.GOOGLE_CLIENT_ID = 'test-id';
      delete process.env.GOOGLE_CLIENT_SECRET;

      let result = await manager.refreshToken();
      expect(result).toEqual({ refresh_token: 'test-rt' });
    });

    it('should cover dynamic import success', async () => {
      jest.doMock('google-auth-library', () => {
        return {
          OAuth2Client: class OAuth2Client {
            setCredentials() {}
            refreshAccessToken() {
              return Promise.resolve({ credentials: { access_token: 'mock-token' } });
            }
          }
        };
      });

      await jest.isolateModulesAsync(async () => {
        const configMod = require('../src/common/config');
        const m = new configMod.ConfigManager();
        const fsMod = require('fs');
        jest.spyOn(fsMod, 'existsSync').mockImplementation((p: any) => {
          if (typeof p === 'string') return p.includes('tokens.json');
          return false;
        });
        jest.spyOn(fsMod, 'readFileSync').mockReturnValue(JSON.stringify({ refresh_token: 'test-rt' }));
        jest.spyOn(fsMod, 'writeFileSync').mockImplementation(() => undefined);
        process.env.GOOGLE_CLIENT_ID = 'test-id';
        process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

        const res = await m.refreshToken();
        expect(res).toBeDefined();
        expect(res.access_token).toBe('mock-token');
      });
    });

    it('should handle refresh token error and return original tokens', async () => {
      jest.doMock('google-auth-library', () => {
        return {
          OAuth2Client: class OAuth2Client {
            setCredentials() {}
            refreshAccessToken() {
              return Promise.reject(new Error('Refresh failed'));
            }
          }
        };
      });

      await jest.isolateModulesAsync(async () => {
        const configMod = require('../src/common/config');
        const m = new configMod.ConfigManager();
        const fsMod = require('fs');
        jest.spyOn(fsMod, 'existsSync').mockImplementation((p: any) => {
          if (typeof p === 'string') return p.includes('tokens.json');
          return false;
        });
        jest.spyOn(fsMod, 'readFileSync').mockReturnValue(JSON.stringify({ refresh_token: 'test-rt' }));
        process.env.GOOGLE_CLIENT_ID = 'test-id';
        process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

        jest.spyOn(console, 'error').mockImplementation(() => {});
        const result = await m.refreshToken();
        expect(result).toEqual({ refresh_token: 'test-rt' });
        (console.error as jest.Mock).mockRestore();
      });
    });
  });

  describe('config edge cases', () => {
    it('should cover custom config dir', () => {
      const { ConfigManager } = require('../src/common/config');
      const customManager = new ConfigManager('/custom');
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'readFileSync').mockReturnValue(JSON.stringify({ sandbox: { image: 'custom' } }));
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined);
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);

      const cfg = customManager.loadConfig();
      expect(cfg.sandbox.image).toBe('custom');

      customManager.saveConfig(cfg);
      customManager.saveTokens({ access_token: '123' });

      const t = customManager.loadTokens();
      expect(t.sandbox).toBeDefined(); // Actually JSON.parse will return the mock object
    });

    it('should cover ensureConfigDir when dir does not exist', () => {
      const { ConfigManager } = require('../src/common/config');
      const customManager = new ConfigManager('/custom');
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
      customManager.saveConfig({});
    });
  });

  describe('saveTokens / loadTokens', () => {

    it('should save tokens correctly', () => {
      manager.saveTokens(mockTokens);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        TOKENS_PATH,
        JSON.stringify(mockTokens, null, 2)
      );
    });

    it('should load tokens if file exists', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p) => p === TOKENS_PATH);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockTokens));
      const tokens = manager.loadTokens();
      expect(tokens).toEqual(mockTokens);
    });

    it('should return null if tokens file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const tokens = manager.loadTokens();
      expect(tokens).toBeNull();
    });
  });
});
