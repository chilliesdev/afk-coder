import { DockerRuntime } from '../src/daemon/runtime-docker';
import { ConfigManager } from '../src/common/config';

jest.mock('../src/common/config', () => ({
  ConfigManager: jest.fn()
}));

describe('Sandbox Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if no authentication is provided', async () => {
    (ConfigManager as jest.Mock).mockImplementation(() => ({
      loadTokens: jest.fn().mockReturnValue(null),
      refreshToken: jest.fn().mockResolvedValue(null),
      loadConfig: jest.fn().mockReturnValue({
        sandbox: {
          image: 'test-image',
          memory: 1234,
          nanoCpus: 5678,
        },
        auth: {
          clientId: '',
          clientSecret: '',
        }
      })
    }));

    const sandbox = new DockerRuntime();
    await expect(sandbox.start('/test/dir')).rejects.toThrow(
      'Authentication required. Please run "afk-coder login" or set the GEMINI_API_KEY environment variable.'
    );
  });
});
