// Pi RPC driven over a held-open `docker exec -i`, via dockerode's hijacked
// duplex stream. This is the piece today's ExecutionRuntime cannot express:
// run() -> wait() is exec-and-collect, this is a long-lived bidirectional channel.
import { PassThrough } from 'node:stream';
import { attachJsonlLineReader, serializeJsonLine } from './jsonl.mjs';

export class DockerRpcSession {
  constructor(docker, container) {
    this.docker = docker;
    this.container = container;
    this.pending = new Map();       // id -> {resolve, reject}
    this.eventHandlers = [];
    this.events = [];               // everything, for the spike's post-mortem
    this.stderr = '';
    this.nextId = 1;
    this.exited = false;
  }

  async start(cmd = ['pi', '--mode', 'rpc']) {
    this.exec = await this.container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    // hijack + stdin is what makes the stream writable as well as readable.
    this.stream = await this.exec.start({ hijack: true, stdin: true });

    const stdout = new PassThrough();
    const stderr = new PassThrough();
    this.docker.modem.demuxStream(this.stream, stdout, stderr);

    stderr.on('data', (c) => { this.stderr += c.toString('utf8'); });

    attachJsonlLineReader(stdout, (msg) => {
      this.events.push(msg);
      if (msg.type === 'response' && msg.id && this.pending.has(msg.id)) {
        const { resolve } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        resolve(msg);
        return;
      }
      for (const h of this.eventHandlers) h(msg);
    });

    this.stream.on('end', () => { this.exited = true; });
    this.stream.on('close', () => { this.exited = true; });
  }

  onEvent(fn) { this.eventHandlers.push(fn); }

  send(command, extra = {}) {
    const id = String(this.nextId++);
    const payload = { id, type: command, ...extra };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout waiting for response to ${command}`));
        }
      }, 30_000).unref?.();
    });
    this.stream.write(serializeJsonLine(payload));
    return promise;
  }

  // prompt is async-ack: success means preflight passed, not that the turn ran.
  // The turn is over at agent_settled, NOT agent_end (pi may auto-retry/compact).
  //
  // BUT: if preflight fails (e.g. no API key) the ack comes back success:false
  // and NO agent_settled is ever emitted. Waiting on agent_settled alone
  // deadlocks until timeout — so race the ack against it.
  async promptAndWaitForSettled(message, timeoutMs = 180_000) {
    const collected = [];
    let settle;
    const settled = new Promise((resolve, reject) => {
      settle = { resolve, reject };
      const t = setTimeout(() => reject(new Error('timeout waiting for agent_settled')), timeoutMs);
      t.unref?.();
      this.onEvent((msg) => {
        collected.push(msg);
        if (msg.type === 'agent_settled' || msg.event?.type === 'agent_settled') {
          clearTimeout(t);
          resolve(collected);
        }
      });
    });
    const ack = await this.send('prompt', { message });
    if (ack.success === false) {
      settle.resolve(collected);
      return { ack, events: collected, preflightFailed: true };
    }
    return { ack, events: await settled };
  }

  async abort() { return this.send('abort'); }

  // Graceful stop: closing our write end is stdin EOF -> pi shutdown(0).
  async endStdin() {
    this.stream.end();
    await new Promise((r) => setTimeout(r, 1500));
  }

  async inspect() {
    try { return await this.exec.inspect(); } catch (e) { return { error: String(e) }; }
  }
}
