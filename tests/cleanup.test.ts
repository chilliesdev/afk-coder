import { cleanup } from '../src/cli/cleanup';

describe('Cleanup', () => {
  let stdoutWriteSpy: jest.SpyInstance;
  let isTTYOriginal: boolean | undefined;

  beforeEach(() => {
    stdoutWriteSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    isTTYOriginal = process.stdout.isTTY;
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
    Object.defineProperty(process.stdout, 'isTTY', {
      value: isTTYOriginal,
      configurable: true,
      writable: true
    });
  });

  it('should restore cursor if isTTY is true', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
      writable: true
    });
    cleanup();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\u001B[?25h');
  });

  it('should not restore cursor if isTTY is false', () => {
    Object.defineProperty(process.stdout, 'isTTY', {
      value: false,
      configurable: true,
      writable: true
    });
    cleanup();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
