# How a parent process can drive Pi

Research notes for [issue #56](https://github.com/chilliesdev/afk-coder/issues/56).

**File location:** the repo has no research-notes convention (`docs/` holds prose, `docs/adr/` holds ADRs).
I chose `docs/research/` as a new sibling directory. Move it if a convention lands later.

**Method.** Everything below was read from the Pi source tree at
`https://github.com/earendil-works/pi` (`main`, package version `0.84.1`), fetched raw. Docs were
read too, but where docs and source disagree the source wins and the disagreement is called out.
Claims I could not verify from source are marked **not found in primary sources** — I did not infer
them from general LLM-tooling knowledge.

**Version pinned:** `@earendil-works/pi-coding-agent@0.84.1`, `@earendil-works/pi-agent-core@0.84.1`,
`@earendil-works/pi-ai@0.84.1`
(https://raw.githubusercontent.com/earendil-works/pi/main/packages/coding-agent/package.json).

---

## 0. Correcting the premise

Two details in the issue are slightly off, and they matter for the integration:

- **`createAgentSession` is not in `@earendil-works/pi-agent-core`.** It is exported from
  `@earendil-works/pi-coding-agent` (source: `packages/coding-agent/src/core/sdk.ts`, package name
  from `packages/coding-agent/package.json`). `pi-agent-core` is `packages/agent/` — the
  provider-agnostic `Agent` + loop, no tools, no sessions, no coding-agent behaviour. Driving Pi
  "as a coding agent" from Node means depending on `pi-coding-agent`, which is the same package that
  ships the `pi` binary (`"bin": {"pi": "dist/cli.js"}`).
- **There are three non-interactive mechanisms, but `-p` and `--mode json` are one code path**, not
  two. Both are `runPrintMode` with `mode: "text" | "json"`
  (`packages/coding-agent/src/modes/print-mode.ts:33`). They differ in what they print and — as
  shown below — in whether they set an exit code at all.

Also: `packages/coding-agent/docs/json.md` links to `github.com/earendil-works/pi-mono/...` for the
event type definitions. That org/repo 301-redirects to `earendil-works/pi`; the links resolve but
are stale. The type definitions themselves are accurate against source.

---

## 1. The three mechanisms at a glance

| | `pi -p` (text) | `pi --mode json` | `pi --mode rpc` | SDK (`createAgentSession`) |
|---|---|---|---|---|
| Process shape | one-shot, exits | one-shot, exits | long-lived, one session per process | in-process, no subprocess |
| Transport | plain text on stdout | LF-delimited JSONL on stdout | LF-delimited JSONL both directions | function calls + `subscribe()` |
| Structured token usage | **no** | **yes** (on `message_end`) | **yes** (events + `get_session_stats`) | **yes** (same events + `getSessionStats()`) |
| Terminal "turn complete" | process exit | `agent_end` | `agent_end` then `agent_settled` | same as RPC |
| Tool calls visible | no | yes | yes | yes |
| Mid-run cancellation | SIGTERM only | SIGTERM only | `{"type":"abort"}` **or** SIGTERM | `session.abort()` |
| Meaningful exit code | **1 on model error** | **always 0** | 0 / 143 / 129 | n/a |
| Error classes | prose on stderr | prose in `errorMessage` | prose in `errorMessage` | prose in `errorMessage` |
| Container fit | trivial (`docker exec`) | trivial (`docker exec`) | needs a held-open `docker exec -i` | requires Pi *inside* the daemon, breaking the container boundary |

---

## 2. Event / output schema

### 2.1 `--mode json`

Source: `packages/coding-agent/src/modes/print-mode.ts:108-127`. The stream is:

1. One session header line, written before anything else:
   `{"type":"session","version":3,"id":"…","timestamp":"…","cwd":"…"}`
   (`print-mode.ts:122-127`; the shape comes from `agent-session.ts:3260`).
2. Then every `AgentSessionEvent`, one JSON object per line, passed through `toJsonEvent`
   (`packages/coding-agent/src/modes/json-event.ts`).

`toJsonEvent` only strips the cumulative `partial` snapshot from `message_update` events. Nothing
else is redacted or reshaped — the wire event is the in-process event.

The event union (`packages/coding-agent/src/core/agent-session.ts:141-183`) is the base
`AgentEvent` union (`packages/agent/src/types.ts`, mirrored in `docs/json.md`) plus session-level
additions:

```
agent_start
turn_start
message_start   { message }
message_update  { assistantMessageEvent }        // deltas only on the wire
message_end     { message }                      // authoritative message
tool_execution_start   { toolCallId, toolName, args }
tool_execution_update  { toolCallId, toolName, args, partialResult }
tool_execution_end     { toolCallId, toolName, result, isError }
turn_end        { message, toolResults }
agent_end       { messages, willRetry }          // session-level: adds willRetry
agent_settled
queue_update    { steering, followUp }
compaction_start / compaction_end
auto_retry_start { attempt, maxAttempts, delayMs, errorMessage }
auto_retry_end   { success, attempt, finalError? }
summarization_retry_* / bash_execution_update
entry_appended  { entry }
session_info_changed / thinking_level_changed
```

### 2.2 Token usage — structured, and good

This is the strongest answer in the whole investigation. Every `message_end` for an assistant
message carries the full `AssistantMessage`, and `AssistantMessage.usage` is a typed struct
(`packages/ai/src/types.ts:370-435`):

```typescript
interface Usage {
  input: number; output: number;
  cacheRead: number; cacheWrite: number; cacheWrite1h?: number;
  reasoning?: number;          // subset of output
  totalTokens: number;
  cost: { input; output; cacheRead; cacheWrite; total };  // all numbers
}
```

So the parent gets **per-message input/output/cache/total tokens and a computed cost in USD**, with
no scraping. `turn_end.message` and `agent_end.messages[]` carry the same objects, so summing over
`agent_end.messages` gives a whole-run total. Note `usage.input` does **not** include `cacheRead` —
`isContextOverflow` adds them explicitly (`packages/ai/src/utils/overflow.ts:146`), and
`getSessionStats` reports them as separate fields, so afk-coder's `TokenUsage.total` should be
`input + output + cacheRead + cacheWrite` to match Pi's own arithmetic
(`packages/coding-agent/src/core/agent-session.ts:3162-3167`).

RPC additionally has a pull API: `{"type":"get_session_stats"}` →
`SessionStats { userMessages, assistantMessages, toolCalls, toolResults, totalMessages,
tokens{input,output,cacheRead,cacheWrite,total}, cost, contextUsage? }`
(`agent-session.ts:262-279`, `:3122-3170`). The SDK exposes the same via `session.getSessionStats()`.

`pi -p` (text) prints only the assistant's text content (`print-mode.ts:149-153`). **No usage at
all** — not on stdout, not on stderr.

### 2.3 Terminal "turn complete"

Two distinct signals, and the difference matters:

- `agent_end` — one low-level agent run finished. It carries `willRetry: boolean`, computed by
  `_willRetryAfterAgentEnd` (`agent-session.ts:637`, `:683-698`): true when retries are enabled,
  budget remains, and the last assistant message is a retryable error. **`agent_end` is not the end
  of the work** — Pi may auto-retry, auto-compact and retry, or drain queued follow-ups.
- `agent_settled` — emitted from `_emitAgentSettled` (`agent-session.ts:596-603`) once nothing more
  will run automatically. `docs/extensions.md:560` states this explicitly. RPC mode uses it as its
  own shutdown checkpoint (`rpc-mode.ts:357-359`).

**A parent must wait for `agent_settled`, not `agent_end`.** In `--mode json` the process exiting is
equivalent, so `agent_end`-vs-`agent_settled` only bites RPC/SDK consumers.

### 2.4 "The model did nothing" — derivable, not reported

There is no `no_progress` outcome anywhere in Pi. **Not found in primary sources.** What you *can*
compute, structurally:

- `turn_end.toolResults.length === 0` for every turn, and no `toolCall` content blocks in
  `agent_end.messages` → the model only talked.
- `get_session_stats.toolCalls` / `.toolResults` (RPC/SDK) as a before/after delta.
- `message.stopReason` on the final assistant message: `"stop"` (clean), `"length"` (truncated),
  `"toolUse"`, `"error"`, `"aborted"` (`packages/ai/src/types.ts:393`).

None of that answers afk-coder's actual question ("did a task get completed?"), which today comes
from `newlyCompletedCount` off the task board, not from the agent
(`src/daemon/agent-outcome.ts:14-27`). That stays true under Pi: the *filesystem/task-board* remains
the progress oracle. Pi improves it only by making "the agent never called a single tool" cheap to
detect instead of a heuristic.

---

## 3. Error surfacing — the central finding

**Pi has no structured error codes. It classifies its own errors by regexing prose.** This is not an
inference; it is how the shipped code works.

A failed provider call becomes an `AssistantMessage` with `stopReason: "error"` and a free-text
`errorMessage` (`packages/ai/src/types.ts:415-435`). The HTTP status *is* extracted from the SDK
error object by `normalizeProviderError` (`packages/ai/src/utils/error-body.ts:38-67`) — and then
immediately **formatted into a string** by `formatProviderError` (`:128-135`) as
`"<status>: <body>"` or `"<prefix> (<status>): <message>"`. The numeric status is not preserved as
a field on the message. Callers get the string.

Pi's own downstream logic then regexes that string:

- `packages/ai/src/utils/retry.ts:7-90` — two regex unions.
  `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN` matches `insufficient_quota`, `quota exceeded`,
  `out of budget`, `billing`, `Monthly usage limit reached`, `GoUsageLimitError`, … .
  `RETRYABLE_PROVIDER_ERROR_PATTERN` matches `rate.?limit`, `too many requests`, `429`, `500`–`504`,
  `overloaded`, plus ~30 transport strings. `isRetryableAssistantError` (`:223-228`) is literally
  `pattern.test(message.errorMessage)`.
- `packages/ai/src/utils/overflow.ts:37-63` — 24 regexes for context overflow, one per provider
  wording, with a documented list of which providers are "unreliable".

Per error class:

| Class | How it surfaces | Machine-readable? |
|---|---|---|
| **Rate limit / transient 429** | `stopReason: "error"`, `errorMessage` containing provider prose. Pi auto-retries and emits `auto_retry_start {attempt, maxAttempts, delayMs, errorMessage}` / `auto_retry_end {success, attempt, finalError}`. | The *retry events* are structured. The *cause* is prose. |
| **Quota / billing exhaustion** | Same shape. Distinguished from a transient 429 only by `NON_RETRYABLE_PROVIDER_LIMIT_ERROR_PATTERN`. Observable side-effect: no `auto_retry_start` is emitted, and `agent_end.willRetry === false`. | Prose. `willRetry:false` is a usable proxy but conflates "quota" with "budget exhausted" and "unrecognised error". |
| **Provider auth failure** | Two sub-cases. *Pre-flight* (no key/model configured): `main.ts:902-905` prints `formatNoModelsAvailableMessage()` — `"No models available. Use /login to log into a provider…"` — to stderr and `process.exit(1)`, before any events are emitted. *Mid-run* (401/403 from provider): an ordinary `stopReason: "error"` with the status folded into the prose. | Prose both ways. The pre-flight case at least gives exit 1 and no session header line. |
| **Content-safety refusal** | **Partially structured — the one good case.** `AssistantMessage.rawStopReason` preserves the provider's raw terminator. Anthropic maps `"refusal"` and `"sensitive"` to `stopReason:"error"` with a canned `errorMessage`, keeping `rawStopReason` (`packages/ai/src/api/anthropic-messages.ts:709`, `:1328-1350`). Google maps `SAFETY`, `PROHIBITED_CONTENT`, `BLOCKLIST`, `SPII`, `RECITATION`, `IMAGE_SAFETY`, … all to `"error"` but sets `rawStopReason = candidate.finishReason` first (`packages/ai/src/api/google-generative-ai.ts:215-221`), and the field survives into the emitted error message (`:279-289`). | **Yes, via `rawStopReason`** — for Anthropic, Google (both APIs), OpenAI Responses/Completions, Mistral, Bedrock. Not universal: whether a given provider populates it is per-adapter. |

`AssistantMessage.diagnostics[]` (`packages/ai/src/utils/diagnostics.ts`) can carry an SDK error
`code`, but a repo-wide search shows `appendAssistantMessageDiagnostic` is called from only three
providers (`pi-messages`, `bedrock-converse-stream`, `openai-codex-responses`). It is not a general
classification channel.

### 3.1 The structured escape hatch: extensions

There is one way to get a real HTTP status out of Pi, and it works in every mechanism because
extensions run in-process wherever `pi` runs:

- `after_provider_response` fires with `{ status, headers }` before the stream body is consumed
  (`docs/extensions.md:695-710`; wired at `packages/coding-agent/src/core/sdk.ts:338-348`). The doc's
  own example is `if (event.status === 429) …` reading `headers["retry-after"]`.
- The extension can then push a structured record onto the same stdout stream the parent is already
  reading: `pi.appendEntry(customType, data)` appends a custom session entry and emits
  `{"type":"entry_appended","entry":{…}}` (`agent-session.ts:2385-2391`). Custom entries do **not**
  enter LLM context (`docs/extensions.md:1446`), so this does not contaminate the conversation.
- `ctx.ui.notify(...)` is an alternative but is a **no-op in `--mode json` and `-p`** —
  `ctx.hasUI` is `false` there and `true` only in TUI and RPC (`docs/extensions.md:947`). Use
  `appendEntry`, not `notify`.

So: a ~40-line `-e` extension turns "quota vs auth vs rate-limit" from a regex problem into a
status-code problem, in JSON mode as well as RPC. This is the single highest-leverage finding for
afk-coder. Caveat: header availability is provider- and transport-dependent
(`docs/extensions.md:711`).

---

## 4. Cancellation

### 4.1 SIGTERM (all subprocess mechanisms)

Both print mode and RPC mode install the same handler for `SIGTERM` (and `SIGHUP` off Windows):

- `print-mode.ts:50-68` → `killTrackedDetachedChildren()`, dispose the runtime, `process.exit(143)`
  for SIGTERM / `129` for SIGHUP.
- `rpc-mode.ts:366-380` → same, routed through `shutdown(143 | 129, signal)` (`:724-741`).

`shutdown` unsubscribes, disposes the runtime, detaches stdin and exits — but **deliberately skips
the stdout flush on SIGTERM** (`rpc-mode.ts:737-739`: `if (signal !== "SIGTERM") await
flushRawStdout()`). Consequence for a parent: **on SIGTERM you may lose buffered trailing JSONL
lines.** Do not SIGTERM and then expect a final usage tally.

Notably, **neither mode handles SIGINT.** Not found in primary sources for print/RPC; the handler
arrays are `["SIGTERM"]` (+ `"SIGHUP"`) only.

### 4.2 In-band abort (RPC and SDK only)

`{"type":"abort"}` → `session.abort()` (`rpc-mode.ts:428-431`), which is
`abortRetry(); agent.abort(); await waitForIdle()` (`agent-session.ts:1550-1554`).
`agent.abort()` aborts the active run's `AbortController` (`packages/agent/src/agent.ts:319-320`).
The in-flight assistant message is finalised with `stopReason: "aborted"`
(`agent-loop.ts:196-199` emits `turn_end` + `agent_end` and returns; `agent.ts:511-519` sets
`stopReason: aborted ? "aborted" : "error"`). Aborts during retry backoff are normalised to the same
aborted-message shape (`packages/ai/src/utils/retry.ts:199-208`).

This is a **clean, in-band, mid-flight cancel that leaves the process alive and the stream flushed**
— strictly better than killing the container process. The RPC `abort` returns
`{"type":"response","command":"abort","success":true}` only after the agent is idle.

`AgentSession.dispose()` and `AgentSessionRuntime.dispose()` are the SDK equivalents; the reference
client `RpcClient.stop()` does SIGTERM then SIGKILL after 1 s
(`packages/coding-agent/src/modes/rpc/rpc-client.ts:145-166`) — worth copying as the timeout shape.

---

## 5. Exit codes

Read `print-mode.ts:33-168` and `main.ts:957-970` together:

```typescript
if (mode === "text") {                                  // print-mode.ts:139
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage?.role === "assistant") {
    if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
      console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
      exitCode = 1;                                     // <-- only inside `mode === "text"`
    } else { …print text… }
  }
}
```

- **`pi -p` (text): exit 1** when the final assistant message has `stopReason` `error` or `aborted`,
  with `errorMessage` on stderr. Exit 1 also on a thrown error (`:159-161`).
- **`pi --mode json`: exit 0 even when the run failed.** The `exitCode = 1` assignment is
  unreachable in JSON mode. A quota-exhausted or safety-blocked run exits `0`. **Verified from
  source; the docs do not mention this.**
- Startup failures exit 1 before any events (`main.ts:894-911`): extension load errors, no model
  available, etc.
- Signals: 143 (SIGTERM) / 129 (SIGHUP).
- RPC: `0` on clean shutdown (stdin EOF → `shutdown()`, `rpc-mode.ts:800-803`), 143/129 on signal.

There is **no distinct exit code per failure class** anywhere. `pi -p` gives you a binary
succeeded/failed; `--mode json` gives you nothing.

---

## 6. RPC protocol shape

Source: `packages/coding-agent/src/modes/rpc/{rpc-mode,rpc-types,jsonl,rpc-client}.ts`.

**Framing.** Strict LF-only JSONL. `serializeJsonLine` is `JSON.stringify(v) + "\n"`; the reader is
hand-rolled with `StringDecoder` and `buffer.indexOf("\n")` (`jsonl.ts:21-58`). A trailing `\r` is
stripped. The file header states the constraint outright:

> "This intentionally does not use Node readline. Readline splits on additional Unicode separators
> that are valid inside JSON strings and therefore does not implement strict JSONL framing."
> — `packages/coding-agent/src/modes/rpc/jsonl.ts:14-20`

**Confirmed: the issue's `readline` warning is real and documented in source.** `U+2028`/`U+2029`
appear unescaped inside JSON string payloads (e.g. file contents in tool results); Node's `readline`
treats them as line terminators and will split a record in half. Reuse `attachJsonlLineReader`'s
logic verbatim — it is 40 lines.

**Session shape.** Long-lived, **one session per process, many turns**. `runRpcMode` returns
`new Promise(() => {})` to stay alive forever (`rpc-mode.ts:815-816`). Not one-turn-per-connection.
Session replacement happens *in-band* via `new_session` / `switch_session` / `fork` / `clone`
commands, not by restarting the process.

**Correlation.** Every command may carry an optional `id: string`; responses echo it
(`rpc-types.ts:20-73`, `:115-231`). Responses are
`{id?, type:"response", command, success:true, data?}` or
`{id?, type:"response", command, success:false, error:string}` — note `error` is a **string**, not a
code. Malformed input yields `{type:"response", command:"parse", success:false, error:"Failed to
parse command: …"}` (`rpc-mode.ts:748-761`).

**`prompt` is async-ack.** The `prompt` command does not wait for the turn. It returns success as
soon as *preflight* passes (`rpc-mode.ts:394-416`); the actual work arrives as events. So a parent
needs: send `prompt` → collect events → wait for `agent_settled`.

**Startup.** RPC mode emits **no session header line** (unlike `--mode json`) and no ready banner.
Call `get_state` if you need the session id up front.

**Shutdown.** stdin EOF → clean `shutdown(0)`. Closing your write end is the graceful stop.

**Reference client.** `rpc-client.ts` (601 lines) is a complete, typed, spawn-based Node client
already in the package — `start()`, `prompt()`, `abort()`, `onEvent()`, `getSessionStats()`,
`promptAndWait(msg, images, timeout)`, `getStderr()`. It spawns `node <cliPath> --mode rpc`. For
afk-coder it is a template rather than a drop-in, because it spawns directly rather than through
`docker exec`, but the framing/correlation code transfers.

**Container note.** RPC needs a persistent bidirectional pipe: `docker exec -i <container> pi --mode
rpc` held open for the life of the workflow, rather than today's run-to-completion `docker exec`.
That is the main structural change RPC imposes on `runtime-docker.ts`.

---

## 7. SDK surface

Source: `packages/coding-agent/src/core/sdk.ts`, `docs/sdk.md`.

**Construction.** `createAgentSession(options?)` — every option is optional
(`sdk.ts:38-85`, `:169-176`):

```typescript
{
  cwd?, agentDir?,                       // default process.cwd(), ~/.pi/agent
  modelRuntime?,                         // default ModelRuntime.create()
  model?, thinkingLevel?, scopedModels?,
  noTools?: "all" | "builtin",
  tools?: string[], excludeTools?: string[], customTools?: ToolDefinition[],
  resourceLoader?, sessionManager?, settingsManager?, sessionStartEvent?,
}
```

Returns `{ session, extensionsResult, modelFallbackMessage? }`. Note **`model` may end up
`undefined`** with `modelFallbackMessage` set rather than a throw (`sdk.ts:207-222`) — the caller
must check.

**Tools are pluggable, three ways** (`sdk.ts:245-251`, `:38-73`): an allowlist (`tools`), a denylist
(`excludeTools`), a kill switch (`noTools: "all" | "builtin"`), plus `customTools: ToolDefinition[]`
registered alongside built-ins. Individual tool factories are re-exported for custom `cwd`
(`createBashTool`, `createReadTool`, … `sdk.ts:114-126`). Defaults are `["read","bash","edit","write"]`.

**Turn-by-turn?** Partially.
- `session.prompt(text, opts)` is `Promise<void>` and resolves when the whole run settles — that is
  fire-and-forget-with-await, not step-wise.
- Fine-grained control exists but one level down. `AgentLoopConfig` exposes `prepareNextTurn` and
  `shouldStopAfterTurn` hooks consulted after every `turn_end`
  (`packages/agent/src/agent-loop.ts:232-257`); returning true from `shouldStopAfterTurn` halts the
  loop and emits `agent_end`. `agentLoop` / `agentLoopContinue` / `runAgentLoop` /
  `runAgentLoopContinue` are exported from `pi-agent-core` (`packages/agent/src/index.ts`), and
  `agentLoopContinue` resumes from existing context.
- So: true single-stepping means driving `pi-agent-core`'s loop yourself and giving up the
  coding-agent's session/extension/compaction machinery. Through `AgentSession` the granularity is
  "prompt, then observe events, then optionally `steer`/`followUp`/`abort` mid-flight."
- `steer()` (interrupt with a new message) and `followUp()` (queue for after settle) give real
  mid-run influence without full step control (`agent.ts:283-310`).

**Container consequence.** The SDK runs Pi *inside the afk-coder daemon process*. That is exactly
the boundary afk-coder wants to keep — provider credentials, `bash`, `write` and `edit` would all
execute in the daemon, not in the container. Using the SDK while keeping the container boundary
would mean running an afk-coder-authored SDK host *inside* the image and inventing a protocol back
to the daemon — i.e. reimplementing RPC mode. **The SDK is the wrong tool for this consumer**, not
because it is weaker (it is the richest surface) but because it dissolves the boundary.

---

## 8. Session persistence in an ephemeral container

Confirmed from `docs/sessions.md`, `docs/environment-variables.md`, `sdk.ts:179`.

Default: `SessionManager.create(cwd, getDefaultSessionDir(cwd, agentDir))` → JSONL files under
`~/.pi/agent/sessions/`, organised by working directory.

In an ephemeral container this means: sessions are written to the container's writable layer and
**vanish with the container** unless you mount something. Three levers:

| Lever | Effect |
|---|---|
| `pi --no-session` | Ephemeral; nothing written. `PI_SESSION_FILE` is unset for bash tools. |
| `pi --session-dir <dir>` | Redirect storage — point it at a bind mount to survive the container. |
| `PI_CODING_AGENT_SESSION_DIR` | Same, via env; **overridden by `--session-dir`**. |
| `PI_CODING_AGENT_DIR` | Move the whole config dir (default `~/.pi/agent`), incl. `auth.json`. |
| `pi -c` / `--session <path\|id>` / `--fork <path\|id>` | Resume, in exactly one process invocation. |
| SDK: `SessionManager.inMemory()` | No persistence at all. |

`docs/containerization.md:77` is explicit about the trade-off: *"Use a named volume for
`/root/.pi/agent` if you want container-local settings and sessions. Mounting your host `~/.pi/agent`
exposes host auth and session files to the container."*

For afk-coder specifically:
- **Under `--mode json`**, each `docker exec` is a fresh session unless `-c`/`--session` is passed
  *and* the session dir persists. Retry-after-quota loses conversational context by default.
- **Under `--mode rpc`**, one process holds one session across the whole workflow — persistence
  becomes a nice-to-have rather than the mechanism for continuity. This is a real argument for RPC.
- Pi's own Docker recipe (`docs/containerization.md:45-77`) matches afk-coder's existing model:
  `npm install -g @earendil-works/pi-coding-agent`, `WORKDIR /workspace`, `ENTRYPOINT ["pi"]`,
  provider key via `-e ANTHROPIC_API_KEY`. Pi "runs with all permissions by default"
  (`docs/containerization.md:3`), so there is **no `--yolo` equivalent to pass** — the permission
  posture afk-coder gets from `gemini --yolo` is Pi's default. Non-interactive modes additionally
  skip the trust prompt and fall back to `defaultProjectTrust`; pass `-a`/`--approve` to trust
  project-local resources for a run (`README.md:301`).

---

## 9. Gaps that force afk-coder back to string-scraping

Per mechanism, the things that have **no** structured representation.

### `pi -p` (text) — unusable; everything is scraping
1. No token usage of any kind. `agent-outcome.ts:extractTokenUsage` would find nothing to parse and
   fall through to `parseRegexStats`.
2. No error class. Only `errorMessage` prose on stderr.
3. No tool visibility → no structural "no progress" signal at all.
4. No cancellation except SIGTERM.
5. Only gain over today: exit code 1 on a failed run is *reliable* (better than Gemini's).

### `pi --mode json` — fixes usage, leaves error classification and exit codes broken
1. **Quota vs. auth vs. rate-limit is prose.** `errorMessage` is the only signal; the HTTP status is
   formatted away in `formatProviderError`. afk-coder's `classifyError` regexes survive, only with
   different needles. *Unless* you ship an `-e` extension using `after_provider_response` +
   `appendEntry` (§3.1) — then it becomes a status code.
2. **Exit code is always 0.** Verified at `print-mode.ts:139-156`. Any exit-code-based failure
   detection in `runtime-docker.ts` must be replaced by inspecting the final `stopReason` in the
   event stream. This is a silent trap: the run "succeeds" while the agent did nothing.
3. **No `no_progress` outcome.** Must be derived from absent tool calls plus the task board.
4. **No in-band cancel.** `Agent.kill()` must SIGTERM the container process — and SIGTERM
   *skips the stdout flush*, so the last events (including the final usage numbers) can be lost.
5. **Safety refusals are only *partly* structured.** `rawStopReason` is the good path
   (`"refusal"`, `"sensitive"`, `"SAFETY"`, `"PROHIBITED_CONTENT"`, …) but coverage is per-provider;
   for any provider not populating it, safety collapses into the same `stopReason:"error"` + prose
   as everything else.
6. **Pre-flight auth failure emits no events at all** — stderr prose + exit 1, before the session
   header line. Detectable by "exit 1 with zero JSON lines", which is at least structural.
7. Session continuity across retries needs `--session-dir` on a mount plus `-c`/`--session`.

### `pi --mode rpc` — same error-classification gap, everything else solved
1. **Quota vs. auth vs. rate-limit is still prose** — identical to JSON mode; `RpcResponse`'s
   failure shape is `{success:false, error: string}`, a string, not a code. Same extension escape
   hatch applies, and here `ctx.ui.notify` works too (`hasUI === true` in RPC).
2. **No `no_progress` outcome** — but `get_session_stats` makes the tool-call delta a single call
   instead of an event-stream reconstruction.
3. Everything else the issue asks for is available: structured usage (events + `get_session_stats`),
   `agent_settled` as the true terminal signal, `agent_end.willRetry` distinguishing
   "Pi will retry this itself" from "terminal", `auto_retry_start/end` exposing Pi's own backoff,
   clean in-band `abort` with `stopReason:"aborted"`, one session across the whole workflow,
   correlation ids on every command.
4. New costs, not gaps: must hold a `docker exec -i` open; must not use Node `readline`; must
   tolerate `agent_end` firing before `agent_settled`; must handle `prompt`'s async ack.

### SDK — no scraping at all, but wrong shape here
1. Zero gaps on observability: same events, direct object access, `getSessionStats()`,
   `session.abort()`, `SessionManager.inMemory()`.
2. Error classification is *still* prose — the regexes live in `pi-ai` and are what Pi itself uses
   (`isRetryableAssistantError`, `isContextOverflow` are exported and reusable, which is worth
   something: afk-coder could call Pi's own classifier rather than writing its own).
3. **Breaks the container boundary.** Tools, credentials and `bash` execute in the daemon process.
   Keeping the boundary means hosting the SDK inside the image and building a protocol back out —
   which is RPC mode, already written and tested.

---

## 10. Recommendation

**RPC mode.** It is the only mechanism that gives a containerized parent all five of: structured
token usage, a reliable terminal signal (`agent_settled`), clean mid-run cancellation that preserves
the output stream, a persistent session across retries, and request/response correlation. The two
costs are a held-open `docker exec -i` and hand-rolled LF-only line splitting; Pi ships a reference
client for both.

Error classification is the one thing **no** mechanism gives structurally — Pi regexes prose
internally and hands the same prose to consumers. The mitigation is a small `-e` extension using
`after_provider_response` (real HTTP status + `retry-after` header) and `pi.appendEntry` to inject a
typed `entry_appended` record into the stream the parent is already parsing. That converts
afk-coder's `classifyError` from a regex table into a status-code switch, and it works under
`--mode json` too.

If a staged migration is wanted: `--mode json` is a near-drop-in for today's `docker exec`
architecture and immediately fixes token usage — but only if the exit-code trap is handled, because
`--mode json` exits 0 on failure.
