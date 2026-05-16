import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { 
  loadConfig, 
  saveConfig, 
  loadTokens, 
  saveTokens, 
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

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadConfig', () => {
    it('should return default config if config file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const config = loadConfig();
      expect(config.sandbox.image).toContain('gemini-cli/sandbox');
      expect(config.daemon?.socketGroup).toBe('afk-coder-users');
    });

    it('should return merged config if config file exists', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p) => p === CONFIG_PATH);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockConfig));
      const config = loadConfig();
      expect(config.sandbox.image).toBe('test-image');
      expect(config.daemon?.socketGroup).toBe('custom-group');
      expect(config.auth?.clientId).toBe('test-client-id');
    });

    it('should handle JSON parse errors by returning defaults', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      (fs.readFileSync as jest.Mock).mockReturnValue('invalid-json');
      const config = loadConfig();
      expect(config.sandbox.image).toContain('gemini-cli/sandbox');
    });
  });

  describe('saveConfig', () => {
    it('should create directory if it does not exist and write file', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      saveConfig(mockConfig as any);
      expect(fs.mkdirSync).toHaveBeenCalledWith(CONFIG_DIR, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        CONFIG_PATH, 
        expect.stringContaining('"image": "test-image"')
      );
    });
  });

  describe('saveTokens / loadTokens', () => {
    it('should save tokens correctly', () => {
      saveTokens(mockTokens);
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        TOKENS_PATH,
        JSON.stringify(mockTokens, null, 2)
      );
    });

    it('should load tokens if file exists', () => {
      (fs.existsSync as jest.Mock).mockImplementation((p) => p === TOKENS_PATH);
      (fs.readFileSync as jest.Mock).mockReturnValue(JSON.stringify(mockTokens));
      const tokens = loadTokens();
      expect(tokens).toEqual(mockTokens);
    });

    it('should return null if tokens file does not exist', () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const tokens = loadTokens();
      expect(tokens).toBeNull();
    });
  });
});
