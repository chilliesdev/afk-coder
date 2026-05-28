import { Command } from 'commander';
import { LoginCommand } from '../../../../src/cli/commands/login';
import { DaemonClient } from '../../../../src/cli/client';
import { ConfigManager } from '../../../../src/common/config';
import { OAuth2Client } from 'google-auth-library';
const http = require('node:http');
const readline = require('node:readline');

// Mock ConfigManager
jest.mock('../../../../src/common/config');

// Mock google-auth-library
jest.mock('google-auth-library', () => {
  const mockOAuth2Client = {
    generateAuthUrl: jest.fn().mockReturnValue('https://mock-auth-url.com'),
    getToken: jest.fn(),
    setCredentials: jest.fn(),
  };
  return {
    OAuth2Client: jest.fn().mockImplementation(() => mockOAuth2Client),
  };
});

// Mock http
jest.mock('node:http', () => {
  const original = jest.requireActual('node:http');
  return {
    ...original,
    createServer: jest.fn()
  };
});

// Mock readline
jest.mock('node:readline', () => {
  const original = jest.requireActual('node:readline');
  return {
    ...original,
    createInterface: jest.fn()
  };
});

describe('LoginCommand', () => {
  let mockContext: any;
  let mockOAuthClientInstance: any;
  let mockConfigManagerInstance: any;
  let mockServer: any;
  let mockRl: any;
  let consoleLogSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  let originalEnv: any;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    mockContext = {
      client: {} as unknown as DaemonClient,
      validator: {},
    };

    mockOAuthClientInstance = new OAuth2Client();
    (OAuth2Client as unknown as jest.Mock).mockReturnValue(mockOAuthClientInstance);

    mockConfigManagerInstance = {
      loadConfig: jest.fn().mockReturnValue({
        auth: {
          clientId: 'conf-client-id',
          clientSecret: 'conf-client-secret',
          scopes: ['scope1'],
          redirectUri: 'http://localhost:3000'
        }
      }),
      saveConfig: jest.fn(),
      saveTokens: jest.fn(),
    };
    (ConfigManager as jest.Mock).mockImplementation(() => mockConfigManagerInstance);

    mockServer = {
      listen: jest.fn().mockImplementation((port, cb) => cb && cb()),
      close: jest.fn(),
      on: jest.fn(),
    };
    (http.createServer as jest.Mock).mockReturnValue(mockServer);

    mockRl = {
      question: jest.fn(),
      close: jest.fn(),
    };
    (readline.createInterface as jest.Mock).mockReturnValue(mockRl);

    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should register the login command', () => {
    const program = new Command();
    const command = new LoginCommand(mockContext);
    const commandSpy = jest.spyOn(program, 'command');
    
    command.register(program);
    expect(commandSpy).toHaveBeenCalledWith('login');
  });

  it('should reject if clientId or clientSecret are missing', async () => {
    mockConfigManagerInstance.loadConfig.mockReturnValue({ auth: {} });
    
    const command = new LoginCommand(mockContext);
    await expect(command.execute()).rejects.toThrow(/GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set/);
  });

  it('should update config if env client credentials differ from current config', async () => {
    process.env.GOOGLE_CLIENT_ID = 'env-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
    mockOAuthClientInstance.getToken.mockResolvedValue({ tokens: { access_token: '123' } });

    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    // Trigger server callback
    const req = { url: '/?code=authcode' } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;
    const serverCallback = (http.createServer as jest.Mock).mock.calls[0][0];
    await serverCallback(req, res);

    await promise;

    expect(mockConfigManagerInstance.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({
        clientId: 'env-id',
        clientSecret: 'env-secret',
      })
    }));
    expect(consoleLogSpy).toHaveBeenCalledWith('Updated Google Cloud credentials in config.json');
  });

  it('should login via http request successfully', async () => {
    mockOAuthClientInstance.getToken.mockResolvedValue({ tokens: { access_token: 'valid-token' } });

    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    expect(consoleLogSpy).toHaveBeenCalledWith('Authorize this app by visiting this url:', 'https://mock-auth-url.com');
    expect(mockServer.listen).toHaveBeenCalledWith(3000, expect.any(Function));

    // Get the http createServer callback and call it with a code
    const req = { url: 'http://localhost:3000/?code=myauthcode' } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;
    const serverCallback = (http.createServer as jest.Mock).mock.calls[0][0];
    await serverCallback(req, res);

    await promise;

    expect(mockOAuthClientInstance.getToken).toHaveBeenCalledWith('myauthcode');
    expect(mockConfigManagerInstance.saveTokens).toHaveBeenCalledWith({ access_token: 'valid-token' });
    expect(consoleLogSpy).toHaveBeenCalledWith('Login successful! Tokens saved.');
    expect(mockRl.close).toHaveBeenCalled();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should reject if http redirect has an error', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const req = { url: 'http://localhost:3000/?error=access_denied' } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;
    const serverCallback = (http.createServer as jest.Mock).mock.calls[0][0];
    await serverCallback(req, res);

    await expect(promise).rejects.toThrow(/Authentication failed with error: access_denied/);
  });

  it('should handle local server port in use error', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    // Trigger server error EADDRINUSE
    const errorHandler = mockServer.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler({ code: 'EADDRINUSE' });

    await expect(promise).rejects.toThrow(/Port 3000 is already in use/);
  });

  it('should handle general local server errors', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const errorHandler = mockServer.on.mock.calls.find((call: any) => call[0] === 'error')[1];
    errorHandler({ code: 'UNKNOWN', message: 'socket error' });

    await expect(promise).rejects.toThrow(/Local server error: socket error/);
  });

  it('should login via manual code/URL pasting from terminal', async () => {
    mockOAuthClientInstance.getToken.mockResolvedValue({ tokens: { access_token: 'manual-token' } });

    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    // Get the readline question callback
    const questionCallback = mockRl.question.mock.calls[0][1];
    await questionCallback('http://localhost:3000/?code=manualcode');

    await promise;

    expect(mockOAuthClientInstance.getToken).toHaveBeenCalledWith('manualcode');
    expect(consoleLogSpy).toHaveBeenCalledWith('Login successful! Tokens saved.');
  });

  it('should login via manual pure code pasting', async () => {
    mockOAuthClientInstance.getToken.mockResolvedValue({ tokens: { access_token: 'manual-token2' } });

    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const questionCallback = mockRl.question.mock.calls[0][1];
    await questionCallback('rawcode123');

    await promise;

    expect(mockOAuthClientInstance.getToken).toHaveBeenCalledWith('rawcode123');
  });

  it('should handle manual input abort (empty line)', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const questionCallback = mockRl.question.mock.calls[0][1];
    await questionCallback('');

    await promise; // Should resolve on empty manual input
    expect(mockRl.close).toHaveBeenCalled();
    expect(mockServer.close).toHaveBeenCalled();
  });

  it('should reject if manual input URL has no code', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const questionCallback = mockRl.question.mock.calls[0][1];
    await questionCallback('http://localhost:3000/?nocode=1');

    await expect(promise).rejects.toThrow(/Could not extract authorization code/);
  });

  it('should reject if token retrieval fails in finishLogin', async () => {
    mockOAuthClientInstance.getToken.mockRejectedValue(new Error('Token exchange error'));

    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const req = { url: 'http://localhost:3000/?code=myauthcode' } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;
    const serverCallback = (http.createServer as jest.Mock).mock.calls[0][0];
    await serverCallback(req, res);

    await expect(promise).rejects.toThrow(/Error retrieving access token: Token exchange error/);
  });

  it('should handle internal server error in request handler', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    // A getter that throws will trigger the catch block in the request handler
    const req = { get url() { throw new Error('Simulated throw'); } } as any;
    const res = { writeHead: jest.fn(), end: jest.fn() } as any;
    const serverCallback = (http.createServer as jest.Mock).mock.calls[0][0];
    await serverCallback(req, res);

    await expect(promise).rejects.toThrow(/Error retrieving access token: Simulated throw/);
    expect(res.writeHead).toHaveBeenCalledWith(500);
  });

  it('should reject if manual input URL parsing throws an error', async () => {
    const command = new LoginCommand(mockContext);
    const promise = command.execute();
    await new Promise(resolve => setImmediate(resolve));

    const questionCallback = mockRl.question.mock.calls[0][1];
    await questionCallback('http://'); // Invalid URL schema will throw in URL constructor

    await expect(promise).rejects.toThrow(/Invalid URL or code input/);
  });
});
