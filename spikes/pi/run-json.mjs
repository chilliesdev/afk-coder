// Spike 1: CLI print/JSON in the container, through the *existing*
// runtime-docker.ts shape — exec a command string, wait, read exit code + logs.
//   node spikes/pi/run-json.mjs
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { startContainer, stopContainer } from './container.mjs';

const KEY = process.env.PI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
const log = (...a) => console.log('[json]', ...a);

// Verbatim port of DockerRuntime.run()'s collect-and-demux, so the spike
// measures the real seam rather than a friendlier one.
async function runAndWait(container, command) {
  const exec = await container.exec({
    Cmd: ['bash', '-c', command],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ Detach: false });
  const chunks = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  const buf = Buffer.concat(chunks);
  const inspect = await exec.inspect();
  let logs = '';
  let off = 0;
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off + 4);
    if (off + 8 + size > buf.length) break;
    logs += buf.toString('utf8', off + 8, off + 8 + size);
    off += 8 + size;
  }
  return { exitCode: inspect.ExitCode ?? 0, logs };
}

async function main() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-spike-ws-'));
  fs.writeFileSync(path.join(ws, 'add.js'), 'module.exports = (a, b) => a - b;\n');
  const env = ['PI_OFFLINE=1'];
  if (KEY) env.push(`ANTHROPIC_API_KEY=${KEY}`);
  const { container } = await startContainer(ws, env);

  const cases = {
    // Auth failure, no key at all — the cheapest forced failure.
    no_key_json: 'unset ANTHROPIC_API_KEY; pi -p --mode json --provider anthropic "say hi"',
    no_key_text: 'unset ANTHROPIC_API_KEY; pi -p --provider anthropic "say hi"',
    // Auth failure that reaches the provider and comes back 401 *inside the
    // turn* — the case the "always exits 0" claim is actually about.
    // --api-key requires an explicit model, unlike the env var.
    bad_key_json:
      'pi -p --mode json --provider anthropic --model claude-sonnet-4-5 --api-key sk-ant-api03-deliberately-invalid "say hi"',
    bad_key_text:
      'pi -p --provider anthropic --model claude-sonnet-4-5 --api-key sk-ant-api03-deliberately-invalid "say hi"',
  };
  if (KEY) {
    cases.real_task_json =
      'pi -p --mode json --provider anthropic "Fix the bug in add.js so it adds instead of subtracts. Then stop."';
  }

  const results = {};
  try {
    for (const [name, cmd] of Object.entries(cases)) {
      const r = await runAndWait(container, cmd);
      results[name] = r;
      log(`--- ${name}: exitCode=${r.exitCode}`);
      log(r.logs.trim().slice(0, 700).replace(/\n/g, '\n      '));
    }
    if (KEY) results.file_after = fs.readFileSync(path.join(ws, 'add.js'), 'utf8');
  } finally {
    await stopContainer(container);
    fs.writeFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), 'out-json.json'),
      JSON.stringify(results, null, 2),
    );
    fs.rmSync(ws, { recursive: true, force: true });
    log('container removed, findings in spikes/pi/out-json.json');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
