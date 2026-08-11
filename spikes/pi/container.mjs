// Minimal stand-in for DockerRuntime.start()/stop(): a persistent container
// with the workspace bind-mounted, same shape as src/daemon/runtime-docker.ts.
import Docker from 'dockerode';
import * as path from 'node:path';

export const IMAGE = process.env.PI_SPIKE_IMAGE ?? 'afk-pi-spike:0.84.1';

export async function startContainer(workspaceDir, env = []) {
  const docker = new Docker();
  const container = await docker.createContainer({
    Image: IMAGE,
    Cmd: ['tail', '-f', '/dev/null'],
    Env: env,
    HostConfig: {
      Binds: [`${path.resolve(workspaceDir)}:/app`],
      Memory: 2 * 1024 * 1024 * 1024,
      NetworkMode: 'bridge',
    },
    WorkingDir: '/app',
    User: 'root',
  });
  await container.start();
  const inspect = await container.inspect();
  return { docker, container, pid: inspect.State.Pid };
}

export async function stopContainer(container) {
  try { await container.kill(); } catch { /* already stopped */ }
  try { await container.remove(); } catch { /* already gone */ }
}

// Count pi processes still alive in the container — the orphan check.
// Note: pi rewrites its process title to bare "pi", so the argv it was
// launched with (`--mode rpc ...`) is NOT visible in ps. Match the title.
export async function countPiProcesses(container) {
  const exec = await container.exec({
    Cmd: ['bash', '-c', "ps -eo args | grep -cE '^pi$' || true"],
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ Detach: false });
  const chunks = [];
  await new Promise((resolve) => {
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', resolve);
    stream.on('error', resolve);
  });
  const buf = Buffer.concat(chunks);
  let out = '';
  let off = 0;
  while (off + 8 <= buf.length) {
    const size = buf.readUInt32BE(off + 4);
    if (off + 8 + size > buf.length) break;
    out += buf.toString('utf8', off + 8, off + 8 + size);
    off += 8 + size;
  }
  return Number(out.trim()) || 0;
}
