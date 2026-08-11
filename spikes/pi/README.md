# Spike: driving Pi inside the container from a Node parent (#59)

Rough and disposable. Not production code, not wired into `src/`, no tests.

```bash
docker build -t afk-pi-spike:0.84.1 spikes/pi        # node:24-slim + pi 0.84.1
zsh -ic 'node spikes/pi/run-json.mjs'                # spike 1: pi -p --mode json via exec-and-wait
zsh -ic 'node spikes/pi/run-rpc.mjs'                 # spike 2: pi --mode rpc over a held-open exec
node spikes/pi/framing-check.mjs                     # readline vs. LF-only framing
```

`credential.mjs` picks up whichever provider key the host has
(`DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`);
override with `PI_PROVIDER` / `PI_MODEL`. Without any key both spikes fall back
to a deliberately invalid one so the failure paths still get exercised.

**The `zsh -ic` matters**: the key lives in `~/.zshrc`, which only an
*interactive* zsh sources. `zsh -lc` and plain `node` will not see it. Runs
below were against **DeepSeek** (`deepseek-v4-pro`), per #58.

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
| in-band `{"type":"abort"}` **mid-`write`** | tool returns `"Operation aborted"`, `isError: true`, **no file on disk** — not a truncated one |
| in-band abort, then another `prompt` | same session took the next turn through to `agent_settled` |
| in-band abort while idle | `success: true`, channel still usable — `get_state` answered after it |
| stdin EOF (`stream.end()`) | pi exits, exec `ExitCode: 0`, pi processes in container `1 → 0` |
| parent socket destroyed, no EOF (daemon crash) | pi processes `1 → 0` — **no orphan**; Docker reaps the exec when the hijacked connection dies |

So `Agent.kill()` has a graceful path (abort, keeping the session) *and* a hard
path (end the stream), and neither leaves anything behind in the container.

The mid-`write` case is the one that mattered. The spike aborts on the first
`tool_execution_start` after issuing a 12-file writing task; that landed on
`{"toolName":"write","args":{"path":"/app/step1.txt","content":"one"}}`, and the
matching `tool_execution_end` came back:

```json
{"type":"tool_execution_end","toolName":"write","result":{"content":[{"type":"text","text":"Operation aborted"}]},"isError":true}
```

`fs.readdirSync` on the host side of the bind mount then found **zero**
`step*.txt` files. Aborting mid-edit does not leave partial writes, and
`isError: true` makes the aborted call structurally visible.

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

### 8. The real-task path, once #58 landed a DeepSeek key

Both mechanisms completed the same task **inside the container**, editing
through the bind mount — `add.js` went from `a - b` to `a + b`, verified from
the host after the container was gone.

- `--mode json`: exit 0, 3 turns, `stopReason: "stop"`, `rawStopReason: "stop"`,
  `willRetry: false`, `agent_settled`. Tools were `read` then `edit`.
- RPC: identical lifecycle over the channel, plus `get_session_stats` →
  `{tokens:{input:232,output:222,cacheRead:4608,total:5062}, cost:0.00031,
  toolCalls:2, toolResults:2, contextUsage:{percent:0.18}}`.

Event vocabulary observed on a successful turn (both modes):
`session`(json only), `agent_start`, `turn_start`, `message_start`,
`message_update` (~55/turn — the streaming chatter), `message_end`,
`tool_execution_start`, `tool_execution_end`, `turn_end`, `agent_end`,
`agent_settled`. Per-turn `usage` carries `reasoning` tokens separately, and
cache reads are reported (1664 cacheRead on the last turn).

## Still not answered

- **Quota exhaustion** specifically, as distinct from a 401. Would need a
  genuinely exhausted account; the 401 path is a proxy for it and lands in the
  same swallowed-exit-code bucket, but the `errorMessage` shape is unverified.
- **Google OAuth**, deliberately — #62 owns it.
