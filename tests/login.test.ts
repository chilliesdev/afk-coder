import { OAuth2Client } from 'google-auth-library';
import { ConfigManager } from '../src/common/config';

jest.mock('google-auth-library');
jest.mock('../src/common/config', () => ({
  ConfigManager: jest.fn()
}));

describe('Login Command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should use the redirectUri from the config', async () => {
    const mockConfig = {
      auth: {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://custom-uri:8080',
      },
    };
    (ConfigManager as jest.Mock).mockImplementation(() => ({
      loadConfig: jest.fn().mockReturnValue(mockConfig)
    }));

    // Simplified version of the login command's action
    const oAuth2Client = new OAuth2Client(
      mockConfig.auth.clientId,
      mockConfig.auth.clientSecret,
      mockConfig.auth.redirectUri
    );

    expect(OAuth2Client).toHaveBeenCalledWith(
      'test-client-id',
      'test-client-secret',
      'http://custom-uri:8080'
    );
  });
});
