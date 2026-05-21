import { DockerRuntime } from '../src/daemon/runtime-docker';
import { loadTokens, refreshToken, loadConfig } from '../src/common/config';

jest.mock('../src/common/config');

describe('Sandbox Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should throw an error if no authentication is provided', async () => {
    (loadTokens as jest.Mock).mockReturnValue(null);
    (refreshToken as jest.Mock).mockResolvedValue(null);
    (loadConfig as jest.Mock).mockReturnValue({
      sandbox: {
        image: 'test-image',
        memory: 1234,
        nanoCpus: 5678,
      },
      auth: {
        clientId: '',
        clientSecret: '',
      }
    });

    const sandbox = new DockerRuntime();
    await expect(sandbox.run('test prompt', '/test/dir')).rejects.toThrow(
      'Authentication required. Please run "afk-coder login" or set the GEMINI_API_KEY environment variable.'
    );
  });
});
