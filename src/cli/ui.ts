import * as readline from 'node:readline';

export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private currentFrame = 0;
  private readonly frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private message = '';
  private isActive = false;

  constructor(message = '') {
    this.message = message;
  }

  start(message?: string) {
    if (message) {
      this.message = message;
    }

    this.isActive = true;

    if (!process.stdout.isTTY) {
      console.log(this.message);
      return;
    }

    if (this.timer) {
      return;
    }

    // Hide cursor
    process.stdout.write('\u001B[?25l');

    this.timer = setInterval(() => {
      this.render();
      this.currentFrame = (this.currentFrame + 1) % this.frames.length;
    }, 80);
    this.render();
  }

  update(message: string) {
    this.message = message;
    if (!process.stdout.isTTY) {
      console.log(this.message);
      return;
    }
    this.render();
  }

  stop(finalMessage?: string, success = true) {
    if (!this.isActive) {
      return;
    }

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const symbol = success ? (process.stdout.isTTY ? '\u001B[32m✔\u001B[0m' : '✔') : (process.stdout.isTTY ? '\u001B[31m✖\u001B[0m' : '✖');
    const message = finalMessage || this.message;

    if (process.stdout.isTTY) {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`${symbol} ${message}\n`);

      // Show cursor
      process.stdout.write('\u001B[?25h');
    } else {
      console.log(`${symbol} ${message}`);
    }

    this.isActive = false;
  }

  private render() {
    readline.cursorTo(process.stdout, 0);
    readline.clearLine(process.stdout, 0);
    process.stdout.write(`${this.frames[this.currentFrame]} ${this.message}`);
  }
}
