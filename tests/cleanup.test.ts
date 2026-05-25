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
    // @ts-ignore
    process.stdout.isTTY = isTTYOriginal;
  });

  it('should restore cursor if isTTY is true', () => {
    // @ts-ignore
    process.stdout.isTTY = true;
    cleanup();
    expect(stdoutWriteSpy).toHaveBeenCalledWith('\u001B[?25h');
  });

  it('should not restore cursor if isTTY is false', () => {
    // @ts-ignore
    process.stdout.isTTY = false;
    cleanup();
    expect(stdoutWriteSpy).not.toHaveBeenCalled();
  });
});
