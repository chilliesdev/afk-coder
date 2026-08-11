# Spike: driving Pi inside the container from a Node parent (#59)

Rough and disposable. Not production code, not wired into `src/`, no tests.

```bash
docker build -t afk-pi-spike:0.84.1 spikes/pi   # node:24-slim + pi 0.84.1
node spikes/pi/run-json.mjs                     # spike 1: pi -p --mode json via exec-and-wait
node spikes/pi/run-rpc.mjs                      # spike 2: pi --mode rpc over a held-open exec
node spikes/pi/framing-check.mjs                # readline vs. LF-only framing
```

Set `ANTHROPIC_API_KEY` (or `PI_API_KEY`) on the host to run the real-task path.
Without one, both spikes fall back to a deliberately invalid key so the failure
paths still get exercised end to end.

Files:

| file | what it is |
| --- | --- |
| `Dockerfile` | candidate sandbox base — `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` |
| `container.mjs` | stand-in for `DockerRuntime.start()/stop()`, same bind/WorkingDir shape |
| `jsonl.mjs` | LF-only JSONL framing, ported from pi's `modes/rpc/jsonl.ts` |
| `rpc-client.mjs` | RPC session over dockerode's hijacked duplex exec stream |
| `run-json.mjs` | spike 1, using a verbatim port of `DockerRuntime.run()`'s collect-and-demux |
| `run-rpc.mjs` | spike 2 |
| `out-*.json` | raw captured output from the last run |

---

## What the spikes answered

### 1. `ExecutionRuntime` can carry a held-open `docker exec -i` — via dockerode, no shelling out

This was the concrete unknown standing between the paper answer in #56 and #60.
`container.exec({AttachStdin: true, ...})` then `exec.start({hijack: true, stdin: true})`
returns a **duplex** stream: write JSONL commands in, read multiplexed
stdout/stderr out (`docker.modem.demuxStream`). No `child_process`, no shell
string. The same dockerode client already in `runtime-docker.ts`.

Every RPC command round-tripped with `id` correlation: `get_state`,
`get_session_stats`, `prompt`, `abort`.

**But it is a different contract.** `run(prompt, dir) -> handle.wait()` collects
the stream to EOF and returns `{exitCode, logs}`. That shape cannot express a
session that stays open across many turns and emits events as it goes.

### 2. `--mode json` really does exit 0 on a failed turn — reproduced

Same prompt, same invalid key, same failure:

| invocation | exit code |
| --- | --- |
| `pi -p --provider anthropic --model … --api-key <invalid>` (text) | **1** |
| `pi -p --mode json --provider anthropic --model … --api-key <invalid>` | **0** |

`runtime-docker.ts` keys off `exec.inspect().ExitCode`. Under `--mode json` it
would report a false success on a hard auth failure.

**Refinement to the #56 note:** the split is *where* the failure happens, not
just the mode. Failures at **preflight** (no key at all, so no model resolves)
exit **1 in both modes** — pi never enters the agent loop. Failures **inside the
turn** (the provider 401s) are the ones `--mode json` swallows to 0. Quota
exhaustion is an in-turn failure, so it lands in the swallowed bucket.

### 3. Turn failure is structural; the *classification* is semi-structural

The failed turn's tail, in both JSON and RPC mode:

```json
{"type":"message_end","message":{…,"stopReason":"error","errorMessage":"401 {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"API key is invalid.\"},…}"}}
{"type":"turn_end", …same message…, "toolResults":[]}
{"type":"agent_end","messages":[…],"willRetry":false}
{"type":"agent_settled"}
```

- **Failed-vs-succeeded needs no regex**: `stopReason: "error"` plus
  `agent_end.willRetry` are both structural. That is already better than
  `OutcomeAnalyzer`'s stdout classification.
- **The kind of failure is inside `errorMessage`**, which is prose — but for
  Anthropic the prose is `"401 " + the provider's own JSON error body`, so
  `error.type === "authentication_error"` is recoverable by slicing off the
  status code and parsing. That is provider-shaped, not pi-shaped: it will not
  generalise across the ~35 providers. Relevant to #63.
- `agent_settled` **is** emitted on a failed turn, so it stays a safe terminal
  signal.

### 4. A trap the research did not predict: preflight failure emits no `agent_settled`

"Send `prompt`, wait for `agent_settled`" **deadlocks** when preflight fails.
With no credential the ack came back:

```json
{"id":"2","type":"response","command":"prompt","success":false,"error":"No API key found for the selected model.…"}
```

…and then nothing, forever — the first version of the spike hung until its own
timeout. A parent must **race the ack against `agent_settled`** and treat
`ack.success === false` as terminal. See `rpc-client.mjs`
`promptAndWaitForSettled`.

### 5. Cancellation and orphans: clean on every path tested

| path | result |
| --- | --- |
| in-band `{"type":"abort"}` | `success: true`, **channel still usable** — `get_state` answered after it |
| stdin EOF (`stream.end()`) | pi exits, exec `ExitCode: 0`, pi processes in container `1 → 0` |
| parent socket destroyed, no EOF (daemon crash) | pi processes `1 → 0` — **no orphan**; Docker reaps the exec when the hijacked connection dies |

So `Agent.kill()` has a graceful path (abort, keeping the session) *and* a hard
path (end the stream), and neither leaves anything behind in the container.

Note: `ps` inside the container shows the process as bare **`pi`** — pi rewrites
its process title, so its argv is invisible to `ps`. Match on `^pi$`, not on
`--mode rpc`.

### 6. The `readline` hazard is real, and 40 lines fixes it

`framing-check.mjs` feeds one record containing a raw `U+2028` (which
`JSON.stringify` does **not** escape) to both readers:

```
readline produced 2 lines (expected 1)
  PARSE FAILED: SyntaxError: Unterminated string in JSON at position 41
  PARSE FAILED: SyntaxError: Unexpected token 'l', "line two"}" is not valid JSON
jsonl reader produced 1 records (expected 1)
  content intact: true
```

### 7. Incidental findings

- **Do not pass `--api-key` on argv.** It is invisible to `ps` (title rewrite),
  but `docker exec inspect` returns it verbatim in `ProcessConfig.arguments`.
  Env var or a pre-provisioned `auth.json` avoids that. For #62.
- **`--api-key` requires an explicit `--model`**; the env var does not. Error:
  `--api-key requires a model to be specified via --model, --provider/--model, or --models`.
- **`pi --list-models` returns nothing without a credential.** The catalog is
  gated on auth — any "what can we run?" UI has to hold a key first. For #62.
- **The image is cheap.** `node:24-slim` + git + pi installs in ~6s and the whole
  spike (build excluded) runs in seconds. No sign that the base image is a
  hard problem.
- `get_session_stats` returns structured `tokens{input,output,cacheRead,cacheWrite,total}`,
  `cost`, `toolCalls`/`toolResults`, and `contextUsage.percent` — available even
  after a failed turn.

---

## Not answered — needs a real credential (#58)

- A real coding task completed against the scratch repo (does pi's edit tool
  actually write through the bind mount, does the loop terminate sensibly).
- Non-zero token usage and cost readings on a successful turn.
- **Mid-run abort during actual work.** The forced-failure turns end in ~1s, so
  abort was only tested against an idle session. The interesting question —
  does `abort` mid-tool-call leave a half-written file — is untested.
- Quota exhaustion specifically, as distinct from a 401.
