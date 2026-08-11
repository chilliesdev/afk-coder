// Spike 2: RPC into the container.
//   node spikes/pi/run-rpc.mjs
// Reads ANTHROPIC_API_KEY (or PI_API_KEY) from the host env if present; without
// one, everything up to the first provider call still exercises the channel.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startContainer, stopContainer, countPiProcesses } from './container.mjs';
import { DockerRpcSession } from './rpc-client.mjs';

const KEY = process.env.PI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
const PROVIDER = process.env.PI_PROVIDER ?? 'anthropic';
const MODEL = process.env.PI_MODEL ?? '';

const log = (...a) => console.log('[rpc]', ...a);

function makeScratchRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-spike-ws-'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# scratch\n');
  fs.writeFileSync(path.join(dir, 'add.js'), 'module.exports = (a, b) => a - b;\n');
  return dir;
}

async function main() {
  const ws = makeScratchRepo();
  log('workspace', ws);
  log('api key present:', KEY ? 'yes' : 'NO (provider calls will fail)');

  const env = ['PI_OFFLINE=1'];
  if (KEY) env.push(`ANTHROPIC_API_KEY=${KEY}`);

  const { docker, container } = await startContainer(ws, env);
  const session = new DockerRpcSession(docker, container);

  const results = {};
  try {
    const cmd = ['pi', '--mode', 'rpc', '--provider', PROVIDER];
    if (MODEL) cmd.push('--model', MODEL);
    if (!KEY) {
      // No real credential: force a turn that reaches the provider and 401s,
      // so the failure path is exercised anyway. --api-key needs an explicit model.
      cmd.push('--model', 'claude-sonnet-4-5', '--api-key', 'sk-ant-api03-deliberately-invalid');
    }
    await session.start(cmd);
    log('exec started, channel open');

    // --- 1. Is the channel actually bidirectional? -----------------------
    const state = await session.send('get_state');
    results.get_state = state;
    log('get_state ->', JSON.stringify(state).slice(0, 400));

    // --- 2. Does a turn work end to end? --------------------------------
    try {
      const { ack, events } = await session.promptAndWaitForSettled(
        'Fix the bug in add.js so it adds instead of subtracts. Then stop.',
        KEY ? 180_000 : 25_000,
      );
      results.prompt_ack = ack;
      results.event_types = events.map((e) => e.type ?? e.event?.type);
      log('prompt ack ->', JSON.stringify(ack).slice(0, 300));
      log('event types ->', results.event_types.join(', '));
      results.file_after = fs.readFileSync(path.join(ws, 'add.js'), 'utf8');
      log('add.js after ->', results.file_after.trim());
    } catch (err) {
      results.prompt_error = String(err);
      log('prompt path failed:', String(err));
      log('recent events ->', JSON.stringify(session.events.slice(-6)).slice(0, 1200));
    }

    // --- 3. Structured token usage? -------------------------------------
    try {
      const stats = await session.send('get_session_stats');
      results.stats = stats;
      log('get_session_stats ->', JSON.stringify(stats).slice(0, 600));
    } catch (err) {
      results.stats_error = String(err);
      log('get_session_stats failed:', String(err));
    }

    // --- 4. In-band abort ------------------------------------------------
    try {
      const abortAck = await session.abort();
      results.abort = abortAck;
      log('abort ->', JSON.stringify(abortAck).slice(0, 300));
      const after = await session.send('get_state');
      results.state_after_abort = after;
      log('channel alive after abort ->', after.success === true);
    } catch (err) {
      results.abort_error = String(err);
      log('abort failed:', String(err));
    }

    // --- 5. Graceful shutdown via stdin EOF, and orphan check ------------
    const before = await countPiProcesses(container);
    await session.endStdin();
    const after = await countPiProcesses(container);
    results.pi_procs = { before, after };
    results.exec_inspect = await session.inspect();
    log(`pi processes before/after stdin EOF: ${before} -> ${after}`);
    log('exec inspect ->', JSON.stringify(results.exec_inspect).slice(0, 300));

    // --- 6. Abrupt parent death: destroy the socket with no EOF ----------
    // i.e. the daemon crashes mid-session. Does pi orphan inside the container?
    const s2 = new DockerRpcSession(docker, container);
    await s2.start(cmd);
    await s2.send('get_state');
    const aliveBefore = await countPiProcesses(container);
    s2.stream.destroy();
    await new Promise((r) => setTimeout(r, 4000));
    const aliveAfter = await countPiProcesses(container);
    results.orphan_on_socket_destroy = { aliveBefore, aliveAfter };
    log(`pi processes before/after socket destroy: ${aliveBefore} -> ${aliveAfter}`);
    if (aliveAfter > 0) log('ORPHAN: pi survived parent socket death');
  } finally {
    results.stderr_tail = session.stderr.slice(-2000);
    if (session.stderr) log('stderr tail ->', session.stderr.slice(-1500));
    await stopContainer(container);
    fs.writeFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), 'out-rpc.json'),
      JSON.stringify({ results, allEvents: session.events }, null, 2),
    );
    fs.rmSync(ws, { recursive: true, force: true });
    log('container removed, findings in spikes/pi/out-rpc.json');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
