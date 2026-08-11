// Spike 2: RPC into the container.
//   zsh -ic 'node spikes/pi/run-rpc.mjs'
// Uses whatever provider credential the host has (see credential.mjs); without
// one, everything up to the first provider call still exercises the channel.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startContainer, stopContainer, countPiProcesses } from './container.mjs';
import { DockerRpcSession } from './rpc-client.mjs';
import { resolveCredential, FAKE } from './credential.mjs';

const CRED = resolveCredential();

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
  log('credential:', CRED ? `${CRED.provider} via ${CRED.envVar}` : 'NONE (forcing a 401)');

  // Credential goes in as an env var, never on argv: `docker exec inspect`
  // echoes ProcessConfig.arguments back verbatim.
  const env = ['PI_OFFLINE=1'];
  if (CRED) env.push(`${CRED.envVar}=${CRED.value}`);

  const { docker, container } = await startContainer(ws, env);
  const session = new DockerRpcSession(docker, container);

  const results = { provider: CRED?.provider ?? FAKE.provider };
  try {
    const cmd = ['pi', '--mode', 'rpc', '--provider', CRED?.provider ?? FAKE.provider];
    if (CRED?.model) cmd.push('--model', CRED.model);
    if (!CRED) cmd.push('--model', FAKE.model, '--api-key', FAKE.key);
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
        CRED ? 180_000 : 25_000,
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

    // --- 4. In-band abort, mid-tool-call ---------------------------------
    // The question that matters for Agent.kill(): does aborting while pi is
    // actually editing leave a half-written file, and does the session survive?
    if (CRED) {
      try {
        const sawTool = new Promise((resolve) => {
          session.onEvent((msg) => {
            const t = msg.type ?? msg.event?.type;
            if (t === 'tool_execution_start') resolve(t);
          });
        });
        await session.send('prompt', {
          message:
            'Create files step1.txt through step12.txt, one at a time, each containing its own number spelled out in words. Work slowly and do not stop early.',
        });
        const firstTool = await Promise.race([
          sawTool,
          new Promise((r) => setTimeout(() => r('timeout'), 60_000)),
        ]);
        log('first tool activity ->', firstTool);
        const abortAck = await session.abort();
        results.abort_mid_run = abortAck;
        log('abort mid-run ->', JSON.stringify(abortAck).slice(0, 200));

        await new Promise((r) => setTimeout(r, 2000));
        const created = fs.readdirSync(ws).filter((f) => /^step\d+\.txt$/.test(f)).sort();
        results.files_after_abort = created.map((f) => ({
          f,
          bytes: fs.statSync(path.join(ws, f)).size,
          content: fs.readFileSync(path.join(ws, f), 'utf8').slice(0, 60),
        }));
        log('files created before abort ->', JSON.stringify(results.files_after_abort));

        // Does the session survive an abort well enough to take another turn?
        const resumed = await session.promptAndWaitForSettled(
          'How many step files did you create before being interrupted? Answer in one short sentence, do not create more.',
          120_000,
        );
        results.turn_after_abort = {
          ack: resumed.ack,
          types: resumed.events.map((e) => e.type ?? e.event?.type),
        };
        log('turn after abort ->', JSON.stringify(results.turn_after_abort).slice(0, 400));
      } catch (err) {
        results.abort_mid_run_error = String(err);
        log('mid-run abort path failed:', String(err));
      }
    }

    // --- 4b. In-band abort while idle ------------------------------------
    try {
      const abortAck = await session.abort();
      results.abort_idle = abortAck;
      log('abort (idle) ->', JSON.stringify(abortAck).slice(0, 200));
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
