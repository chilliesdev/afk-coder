# Pi: providers, models and credentials — and what afk-coder would still own

Research for issue #57. Question: how does the Pi coding agent
(<https://github.com/earendil-works/pi>) handle providers, models and credentials, and how much of
that concern does `pi-ai` actually absorb versus what a consuming daemon still has to own?

**Method.** Everything below was read from the Pi repository itself — file contents fetched from
`github.com/earendil-works/pi` at `main`, not from blog posts or secondary write-ups. Every claim
cites the file it came from. Claims that are inference rather than observation are marked
**(inferred)**. Things I could not establish are collected in "Not found in primary sources".

**Note on repo naming.** Pi's own docs link source files as `github.com/earendil-works/pi-mono/...`
(e.g. [providers.md L107](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)),
but the readable repo at the URL in the issue is `earendil-works/pi`, and its tree contains those
exact paths. The `pi-mono` links appear to be a stale/mirror name. All citations here use
`earendil-works/pi`, which is what I actually read.

## Headline

Pi absorbs essentially all of it. `pi-ai` owns the provider list (35+ providers), the credential
resolution chain, OAuth login *and* automatic token refresh under a cross-process lock, the model
catalog with per-model capability metadata, cost and token accounting, and cross-provider message
translation. The coding agent layers on `auth.json` / `models.json` / `settings.json` and a
non-interactive `pi auth` command family for extracting resolved credentials.

What afk-coder cannot delegate is small and structural rather than provider-specific: *which*
provider/model a workflow should use, *where* the credential state lives on the host, and *how* that
state crosses the container boundary. None of those require afk-coder to know anything about a
specific vendor's auth protocol.

The one real cost: **`pi-ai` has no Google OAuth path.** See [Google](#7-google-as-a-pi-provider--the-decisive-answer).

---

## 1. Provider and model selection

### CLI (the path a daemon spawning `pi` per workflow would use)

Source: [`docs/usage.md`, "Model Options"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider, such as `anthropic`, `openai`, or `google` |
| `--model <pattern>` | Model pattern or ID; supports `provider/id` and optional `:<thinking>` |
| `--api-key <key>` | API key, overriding environment variables |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling |
| `--list-models [search]` | List available models |

Documented forms include `pi --provider openai --model gpt-4o`, `pi --model openai/gpt-4o`, and
`pi --model sonnet:high` (same file, "Examples").

**Per-invocation: yes, fully.** Provider, model, thinking level and API key are all process-level
CLI flags. A daemon that spawns one `pi` process per workflow gets per-workflow provider selection
for free, and concurrent workflows against *different* providers are just different argv — there is
no shared mutable provider state between processes. **(inferred, but strongly implied:** the only
shared state across processes is `auth.json`, and its writes are serialized by a file lock — see
[§4](#4-credential-handling).**)**

### Non-interactive modes

`-p`/`--print`, `--mode json`, `--mode rpc`
([`docs/usage.md`, "Modes"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)).
`--mode json` emits newline-delimited session events on stdout
([`docs/json.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)),
which is the natural feed for a daemon.

### In-process (SDK) and RPC

- SDK: `createAgentSession({ model, thinkingLevel, scopedModels, modelRuntime })`, and on a live
  session `setModel(model): Promise<void>` / `setThinkingLevel(level)`
  ([`docs/sdk.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), "Model" and "AgentSession").
- RPC mode: `{"type": "set_model", "provider": "anthropic", "modelId": "..."}`, plus `cycle_model`,
  `get_available_models`, `set_thinking_level`
  ([`docs/rpc.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)).
- `pi-ai` itself dispatches per call: `models.complete(model, context, opts)` — the model is an
  argument, not client state ([`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md), "Quick Start" / "Auth").

So the model is per-call at every layer Pi exposes. Nothing forces a process-wide binding.

### Fallback order when no model is given

From [`docs/sdk.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md):
1. restore from session (if continuing), 2. default from settings (`defaultProvider` /
`defaultModel` in `settings.json`), 3. first available model.

"Available" means *has resolvable auth* — `modelRuntime.getAvailable()` returns "only models that
have valid authentication configured" (same file). This matters: a daemon that injects one
credential and omits `--model` gets a deterministic-ish choice, but relying on "first available" is
fragile. **(inferred:** pin the model explicitly.**)**

---

## 2. Which providers, and at what fidelity

`packages/ai/src/providers/` contains ~40 provider modules. The README's "Supported Providers"
list ([`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md))
includes OpenAI, Anthropic, Google, Vertex AI, Azure OpenAI, Amazon Bedrock, OpenAI Codex,
GitHub Copilot, xAI, OpenRouter, Vercel AI Gateway, Cloudflare AI Gateway / Workers AI, Mistral,
Groq, Cerebras, DeepSeek, NVIDIA NIM, Together, Baseten, Fireworks, Hugging Face, Moonshot/Kimi,
ZAI, MiniMax, Qwen Token Plan, Xiaomi MiMo, OpenCode, Ant Ling, Radius, "any OpenAI-compatible API"
(Ollama, vLLM, LM Studio).

One important filter, stated in the README's first paragraphs: *"This library only includes models
that support tool calling (function calling), as this is essential for agentic workflows."* So
**tool calling is guaranteed across the whole catalog** — the single capability a coding agent
cannot do without never varies.

Underneath, there are only four wire APIs a custom provider can speak
([`docs/models.md`, "Supported APIs"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)):
`openai-completions`, `openai-responses`, `anthropic-messages`, `google-generative-ai` (plus
internal ones like `bedrock-converse-stream`, `azure-openai-responses`, `openai-codex-responses`,
`mistral-conversations`, `pi-messages`, visible in `packages/ai/src/api/`).

### Where the abstraction is genuinely uniform

- **Streaming.** One event vocabulary for all providers: `thinking_start` / `thinking_delta` /
  `thinking_end`, text deltas, partial-JSON tool-call streaming
  ([`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md), "Streaming Thinking Content", "Streaming Tool Calls with Partial JSON").
- **Stop reasons.** Normalized to `"pending" | "stop" | "length" | "toolUse" | "error" | "aborted" |
  "deferred"` ([`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts) `StopReason`; README "Stop Reasons"). The raw
  provider value is preserved separately as `rawStopReason`.
- **Token accounting and cost.** Every `AssistantMessage` carries a `usage: Usage` with
  `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`, and a computed
  `cost: { input, output, cacheRead, cacheWrite, total }`
  ([`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts), `Usage` and `AssistantMessage`). The message also carries `api`,
  `provider`, `model`, and optionally `responseModel` (the concrete model when a router picked
  something else). **This is the strongest single argument for the migration:** cost and token
  reporting becomes provider-agnostic in afk-coder for free.
- **Thinking, at the level a consumer cares about.** `reasoning: 'minimal'|'low'|'medium'|'high'|
  'xhigh'|'max'` on `streamSimple`/`completeSimple`; *"If you pass reasoning options to a
  non-reasoning model, they are silently ignored"* (README, "Thinking/Reasoning").
- **Cross-provider message handoff.** Switching provider mid-conversation is explicitly supported:
  user/tool-result messages pass through, foreign thinking blocks are converted to `<thinking>`-
  tagged text, tool calls and text are preserved (README, "Cross-Provider Handoffs").
- **Errors don't throw out of the stream** — they arrive as an error event and a final message with
  `stopReason: "error"` and `errorMessage` (README, "Error Handling").

### Where capability differences do exist (and whether they leak)

Two fields on `Usage` are explicitly non-uniform
([`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)): `cacheWrite1h` — *"Only Anthropic reports this
split"* — and `reasoning` — *"left undefined by providers that don't"* expose a reasoning
breakdown. `responseId` is likewise documented as *"Do not assume it is always present across
providers"* (README, "Stop Reasons"). These are optional fields; a consumer that treats them as
optional sees no leakage.

`Model` carries per-model capability metadata
([`packages/ai/src/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)): `reasoning: boolean`, `thinkingLevelMap`,
`input: ("text"|"image")[]`, `contextWindow`, `maxTokens`, `cost`, `samplingParams`, and a
typed `compat` object. `getSupportedThinkingLevels(model)` exists for querying which levels a
concrete model exposes (README, "Thinking/Reasoning"). So capability differences are *data on the
model object*, queryable, rather than branching a consumer has to write.

The genuinely deep provider-difference surface — `supportsDeveloperRole`,
`supportsReasoningEffort`, `supportsUsageInStreaming`, `maxTokensField`, `requiresThinkingAsText`,
`thinkingFormat`, `cacheControlFormat`, `supportsEagerToolInputStreaming`, `forceAdaptiveThinking`,
`allowEmptySignature`, `supportsStrictTools`, `openRouterRouting`, and ~20 more
([`docs/models.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), "OpenAI Compatibility" and "Anthropic Messages
Compatibility") — is real, and it is large. But it is **only reachable through `models.json` for
custom/proxy providers**; built-in providers ship their own correct values in generated model
metadata (e.g. *"Built-in Anthropic models enable `supportsStrictTools` in their model metadata"*,
*"Built-in models set this automatically"* for adaptive thinking). A consumer using built-in
providers never touches any of it.

**Verdict:** for built-in providers the abstraction is uniform on every axis the issue named — tool
calling (universal by construction), streaming (one event set), thinking (unified level enum plus
per-model support metadata), token accounting (one `Usage` shape, with two documented optional
fields). Capability variance leaks back to the consumer only if afk-coder chooses to support
user-supplied custom providers via `models.json`, and even then it leaks as *config the user
writes*, not code afk-coder writes.

---

## 3. Provider-side extension points afk-coder would inherit for free

- **Any OpenAI/Anthropic/Google-compatible endpoint** via `~/.pi/agent/models.json` — Ollama,
  vLLM, LM Studio, corporate proxies ([`docs/models.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)).
- **Overriding a built-in provider's `baseUrl`** without redefining its models, keeping existing
  OAuth/API-key auth working (same file, "Overriding Built-in Providers").
- **Provider-scoped env overrides per request** — `models.complete(model, ctx, { env: {...} })`,
  used before `process.env` for provider config
  ([`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md), "Provider-Scoped Environment Overrides"). Useful if
  afk-coder ever runs multiple providers in one process.
- **Extensions can register whole custom providers with custom OAuth flows**
  ([`docs/custom-provider.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md); example at
  `examples/extensions/custom-provider-gitlab-duo/`). This is the escape hatch if a Google OAuth
  path is ever needed (see §7).

---

## 4. Credential handling

### Resolution order

Documented ([`docs/providers.md`, "Resolution Order"](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)):

1. CLI `--api-key` flag
2. `auth.json` entry (API key or OAuth token)
3. Environment variable
4. Custom provider keys from `models.json`

The SDK view adds a runtime layer on top ([`docs/sdk.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), "API Keys and
OAuth"): 1. runtime overrides via `setRuntimeApiKey` (not persisted), 2. `auth.json`, 3. env vars,
4. fallback resolver for `models.json` keys. `RuntimeCredentials` implements this as a
`CredentialStore` overlay ([`packages/coding-agent/src/core/runtime-credentials.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/runtime-credentials.ts)).

Critical semantic, from [`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) ("Credential Store"): *"A stored
credential owns its provider: environment variables are only consulted when nothing is stored, and a
failed refresh never silently falls back to an env key."* So a stale `auth.json` entry in a
container image would shadow an injected env var. **(inferred:** provision exactly one mechanism per
provider, don't mix.**)**

### What each path needs

| Path | Works with no TTY? | Notes |
|---|---|---|
| `-e PROVIDER_API_KEY=...` env var | Yes | Full table of ~35 vars in [`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) and [`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) |
| `--api-key <key>` CLI flag | Yes | Highest precedence |
| `auth.json` file, pre-written | Yes | Plain JSON; see shape below |
| `/login` (interactive slash command) | **No** | Interactive mode only ([`docs/usage.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md), "Slash Commands") |
| `pi auth check` / `print-api-key` / `print-bearer-token` | Yes | Non-interactive credential *reading*, not login |
| Ambient cloud credentials (AWS profile/IRSA, gcloud ADC, service account file) | Yes | [`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), "Cloud Providers" |

### `auth.json` — what `/login` writes, and can a daemon write it instead?

**Yes, a daemon can provision it ahead of time.** It is a flat JSON object keyed by provider id, one
type-tagged credential per provider, written with mode `0600`
([`packages/coding-agent/src/core/auth-storage.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/auth-storage.ts): `AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8",
mode: 0o600 }`, plus explicit `chmodSync(this.authPath, 0o600)` on every write; default path
`join(getAgentDir(), "auth.json")`). [`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) states the same: *"The file is
created with `0600` permissions... Auth file credentials take priority over environment variables."*

The type contract ([`packages/ai/src/auth/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/types.ts)):

```ts
interface ApiKeyCredential { type: "api_key"; key?: string; env?: ProviderEnv }
interface OAuthCredential  { type: "oauth"; refresh: string; access: string; expires: number }
type Credential = ApiKeyCredential | OAuthCredential
```

`/login` for OAuth writes exactly that `oauth` shape — e.g. Anthropic's token exchange returns
`{ type: "oauth", refresh, access, expires: Date.now() + expires_in*1000 - 5*60*1000 }`
([`packages/ai/src/auth/oauth/anthropic.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/oauth/anthropic.ts)). Nothing about the file is opaque or
machine-bound. **So the "host logs in once interactively, daemon copies/derives the credential into
each container" pattern is directly supported.**

Refresh is Pi's problem, not the consumer's: *"Refresh is automatic: `models.getAuth(providerId)`
and request paths refresh expired tokens under a credential-store lock, so concurrent requests and
processes cannot double-refresh"* ([`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md), "OAuth Providers"). Writes
go through a `lockfile.lockSync` path in `auth-storage.ts`. This is a real capability afk-coder
currently hand-rolls (`configManager.refreshToken()` in `src/daemon/runtime-docker.ts`).

The `key` field also supports indirection ([`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), "Key Resolution"):
`"!command"` executes a shell command and uses stdout (cached for process lifetime), `"$ENV_VAR"` /
`"${VAR}"` interpolates. So `{"type":"api_key","key":"!op read 'op://vault/item/credential'"}` or
`"key": "$SOME_INJECTED_VAR"` both work — useful for keeping the literal secret out of any file.

### Headless OAuth login, specifically

Pi's OAuth login flows are not TTY-bound in principle — they are driven by an injectable
`AuthInteraction` with `prompt()` / `notify()` callbacks
([`packages/ai/src/auth/types.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/types.ts); [`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md),
"OAuth Providers" shows `models.login('anthropic','oauth',{ prompt, notify })`). Prompt kinds are
`text | secret | select | manual_code`; notifications are `info | auth_url | device_code |
progress`.

Two headless-friendly mechanisms exist:

- **Manual code paste.** Anthropic's login races a loopback callback server against a `manual_code`
  prompt: *"Complete login in your browser. If the browser is on another machine, paste the final
  redirect URL here"* ([`packages/ai/src/auth/oauth/anthropic.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/auth/oauth/anthropic.ts), `loginAnthropic`).
  `docs/providers.md` documents the same for OpenRouter over SSH. The callback host/port are
  overridable via `PI_OAUTH_CALLBACK_HOST` (`anthropic.ts`).
- **Device code.** `packages/ai/src/auth/oauth/device-code.ts` exists and `AuthEvent` has a
  `device_code` variant with `userCode` / `verificationUri` — the fully browser-on-another-machine
  flow. Used by GitHub Copilot **(inferred** from the file set: `oauth/github-copilot.ts` alongside
  `oauth/device-code.ts`; I did not read `github-copilot.ts`**)**.

But note the ergonomics: driving these programmatically means using the **SDK**, not the CLI. The
CLI `/login` is interactive-mode-only, and `pi auth` deliberately does *not* include a login
subcommand — its help lists only `print-api-key`, `print-bearer-token`, `check`
([`packages/coding-agent/src/cli/auth-command.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/auth-command.ts)). `npx @earendil-works/pi-ai login
<provider>` exists ([`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md), "CLI Login") and uses `node:readline` on
stdin ([`packages/ai/src/cli.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/cli.ts)), writing `auth.json` **in the current directory** —
not `~/.pi/agent/`.

**(inferred, recommended shape:** `afk login` becomes a thin host-side wrapper — either shell out to
interactive `pi` on the host, or call `models.login()` from `pi-ai` with afk-coder's own prompt
callbacks. Either way it stops being provider-specific code.**)**

### `pi auth` — the non-interactive credential API

[`packages/coding-agent/src/cli/auth-command.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/auth-command.ts):

```
pi auth print-api-key      [--provider <p>] [--model <m>]
pi auth print-bearer-token [--provider <p>] [--model <m>] [--min-expiry <30m|1h|...>]
pi auth check              [--provider <p>] [--model <m>] [--json] [--credentials] [--no-refresh]
```

`auth check --json` returns `{ status: "ready"|"not_ready"|"invalid", provider, reason?, authType? }`
([`packages/coding-agent/src/cli/auth-check.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/auth-check.ts)) — a clean preflight for the daemon
before starting a container.

`print-bearer-token` is the interesting one for containerization: it resolves an OAuth credential
and *refreshes it first* (default `--min-expiry` 30 minutes;
[`packages/coding-agent/src/cli/credential-print.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/cli/credential-print.ts), which notes it *"refreshes and
persists OAuth credentials with less than five minutes remaining"*). So the host can mint a
short-lived bearer token per container start without ever mounting `~/.pi/agent` into the container.
For Anthropic that token is directly consumable inside the container as `ANTHROPIC_OAUTH_TOKEN`
(or `ANTHROPIC_AUTH_TOKEN`, which is sent as `Authorization: Bearer <token>`) —
[`packages/ai/src/providers/anthropic.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/anthropic.ts) resolves, in order: stored credential key,
`ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_OAUTH_TOKEN`, `ANTHROPIC_API_KEY`.

**(inferred:** this "mint a scoped token on the host, inject it as an env var, never mount host auth"
pattern is materially better than what afk-coder does today, which copies `tokens.json` into a temp
dir and bind-mounts it as `/root/.gemini/oauth_creds.json`. Whether the same trick generalizes to
every OAuth provider depends on whether that provider's `toAuth()` produces a plain bearer — true
for Anthropic (`toAuth` returns `{ apiKey: credential.access }`), unverified elsewhere.**)**

---

## 5. Config file locations and precedence, and the container boundary

### What Pi reads from where

Global config dir defaults to `~/.pi/agent`, overridable with `PI_CODING_AGENT_DIR`
([`docs/environment-variables.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/environment-variables.md)). Per
[`docs/sdk.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md) ("Directories"), `agentDir` supplies:

- `settings.json` — global settings
- `models.json` — custom providers/models
- `auth.json` — credentials
- `sessions/` — session storage
- `extensions/`, `skills/`, `prompts/`, global `AGENTS.md`

Also in that directory: `models-store.json` (cached provider catalogs, for offline use —
[`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)) and `trust.json`
([`docs/usage.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md), "Project Trust").

Per-project (`cwd`-derived): `.pi/settings.json`, `.pi/extensions/`, `.pi/skills/`, `.pi/prompts/`,
`.pi/SYSTEM.md`, `.agents/skills/`, and `AGENTS.md` / `CLAUDE.md` walking up from cwd.

**Precedence: project settings override global; nested objects merge**
([`docs/settings.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md), "Project Overrides"). Sessions:
`--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > `sessionDir` in settings.

**Crucially, credentials and custom models are global-only.** There is no project-local `auth.json`
or `models.json` in the documented layout. So a container that mounts only the workspace at
`/workspace` gets **no credentials at all** unless afk-coder supplies them — by env var, by
`--api-key`, or by writing `auth.json` into the container's own `$PI_CODING_AGENT_DIR`.

### Project trust — a real gotcha for a daemon

[`docs/settings.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md) / [`docs/usage.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md):
*"Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without
an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask`
(default) and `never` ignore those project resources, while `always` trusts them. Pass
`--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run."*

So by default a headless run **silently ignores** `.pi/settings.json`, project extensions and
project skills in the mounted workspace. If afk-coder wants project-local Pi config in the mounted
repo to take effect, it must pass `--approve`. If it does not want it (safer for arbitrary repos),
the default already does the right thing. Either way this is a decision afk-coder has to make
explicitly.

### The SDK escape hatch

`ModelRuntime.create({ authPath, modelsPath })` and `ModelRuntime.create({ credentials })` with any
`CredentialStore` (including `InMemoryCredentialStore`) let a host process keep credentials entirely
out of the filesystem ([`docs/sdk.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md);
[`examples/sdk/09-api-keys-and-oauth.ts`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/sdk/09-api-keys-and-oauth.ts)). Relevant if afk-coder ever
embeds Pi rather than spawning it.

---

## 6. Getting credentials into the sandbox

### What Pi's own doc does

[`docs/containerization.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md) offers three patterns:

| Pattern | What is isolated | Credential handling |
|---|---|---|
| Gondolin micro-VM extension | built-in tools and `!` commands only | pi runs on host, **auth stays on host** |
| Plain Docker | whole `pi` process | *"Provider API keys enter the container."* |
| NVIDIA OpenShell | whole `pi` process | gateway can *"keep raw model API keys outside the sandbox"* and inject upstream |

The plain-Docker recipe is:

```
docker run --rm -it -e ANTHROPIC_API_KEY \
  -v "$PWD:/workspace" -v pi-agent-home:/root/.pi/agent pi-sandbox
```

with the explicit warning: *"Mounting your host `~/.pi/agent` exposes host auth and session files to
the container."* A **named volume** for `/root/.pi/agent` is the recommended way to get
container-local settings and sessions without exposing host state.

Note the base image is a plain `node:24-bookworm-slim` with `npm install -g
@earendil-works/pi-coding-agent` — i.e. afk-coder would build and own its sandbox image rather than
pinning a vendor-published one.

### The full option set for afk-coder

1. `-e <PROVIDER>_API_KEY=...` — simplest, matches Pi's own doc.
2. `--api-key <key>` on the `pi` command line inside the container — highest precedence, but puts
   the secret in the container's process argv.
3. Write a minimal `auth.json` into the container's agent dir at start (tmpfs or a per-workflow
   temp dir bind-mounted at `/root/.pi/agent`) — structurally identical to what afk-coder already
   does for `/root/.gemini`, so it is the lowest-friction port of the existing code.
4. Mint a short-lived bearer on the host via `pi auth print-bearer-token --provider X --min-expiry
   1h` and inject it as an env var — best blast-radius story for OAuth providers. **(inferred**
   for providers other than Anthropic.**)**
5. `auth.json` with `"key": "!command"` or `"key": "$VAR"` indirection, so the file itself holds no
   secret ([`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md), "Key Resolution").
6. Route model traffic through a gateway that holds the keys (OpenShell inference routing;
   Cloudflare AI Gateway with stored BYOK; a `models.json` `baseUrl` override on a built-in
   provider). The container then needs no upstream provider key at all.

### What `runtime-docker.ts` does today, and what changes

Current behaviour, from `src/daemon/runtime-docker.ts`:

- Requires `GEMINI_API_KEY` or stored OAuth tokens, else throws "Authentication required. Please run
  `afk login`…" (L28–33).
- If OAuth tokens exist: `mkdtemp` a temp dir, write `.gemini/settings.json` with
  `{ security: { auth: { selectedType: 'oauth-personal' } } }`, copy `tokens.json` to
  `.gemini/oauth_creds.json`, bind-mount that dir at `/root/.gemini` (L39–62).
- Else pass `GEMINI_API_KEY` as an env var (L63–65).
- Always injects `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` from env or `config.auth` (L67–71),
  plus `GEMINI_CLI_TRUST_WORKSPACE=true` and pass-through of `GEMINI_CLI_AUTH_METHOD` /
  `GEMINI_PROJECT_ID` (L74–78).
- Bind-mounts the workspace at `/app`, image from `config.sandbox.image` which defaults to
  `us-docker.pkg.dev/gemini-code-dev/gemini-cli/sandbox:0.41.0` (`src/common/config.ts` L40).

Under Pi, steps 2–4 collapse into "put one credential where Pi looks". The temp-dir-and-bind-mount
machinery survives essentially unchanged if option 3 is chosen — only the filename, path and JSON
shape change (`/root/.gemini/oauth_creds.json` → `/root/.pi/agent/auth.json`). The
`GOOGLE_CLIENT_ID`/`SECRET` injection, the `GEMINI_CLI_*` pass-throughs and `config.auth` all go
away.

---

## 7. Google as a Pi provider — the decisive answer

This is the question that determines whether deleting `google-auth-library` costs existing users
their access. The answer has two halves.

### Gemini models remain reachable — yes, three ways

1. **`google` provider (Gemini API / AI Studio).** Real and built in:
   [`packages/ai/src/providers/google.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/google.ts) —
   ```ts
   createProvider({
     id: "google", name: "Google",
     baseUrl: "https://generativelanguage.googleapis.com/v1beta",
     auth: { apiKey: envApiKeyAuth("Gemini API key", ["GEMINI_API_KEY"]) },
     models: Object.values(GOOGLE_MODELS),
     api: googleGenerativeAIApi(),
   })
   ```
   **API key only.** `auth` has an `apiKey` member and no `oauth` member. Env var `GEMINI_API_KEY`,
   `auth.json` key `"google"` ([`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) table).
2. **`google-vertex` provider (Gemini via Vertex AI).**
   [`packages/ai/src/providers/google-vertex.ts`](https://github.com/earendil-works/pi/blob/main/packages/ai/src/providers/google-vertex.ts) accepts either
   `GOOGLE_CLOUD_API_KEY`, or Application Default Credentials
   (`~/.config/gcloud/application_default_credentials.json`) plus `GOOGLE_CLOUD_PROJECT` and
   `GOOGLE_CLOUD_LOCATION`, or a service-account file via `GOOGLE_APPLICATION_CREDENTIALS`.
3. **Custom `google-generative-ai` provider in `models.json`** with an explicit `baseUrl` — the
   documented way to add AI Studio models Pi doesn't ship
   ([`docs/models.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md), "Google AI Studio Example").

### Does that path need a plain API key, or can it use OAuth?

**The `google` provider needs a plain API key. There is no Google OAuth in `pi-ai`.** Evidence:

- `packages/ai/src/auth/oauth/` contains exactly: `anthropic.ts`, `device-code.ts`,
  `github-copilot.ts`, `kimi-coding.ts`, `load.ts`, `oauth-page.ts`, `openai-codex.ts`,
  `openrouter.ts`, `pkce.ts`, `radius.ts`, `xai.ts`. **No `google.ts`.**
- [`docs/providers.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md) "Subscriptions" (the `/login` OAuth list) is:
  ChatGPT Plus/Pro (Codex), Claude Pro/Max, GitHub Copilot, xAI, OpenRouter, Radius. **Google is
  absent.**
- [`packages/ai/README.md`](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md) "OAuth Providers" lists Anthropic, OpenAI Codex,
  GitHub Copilot, OpenRouter. **Google is absent.**
- A GitHub code search of `earendil-works/pi` for `CodeAssist` returns 0 results — i.e. no
  equivalent of the gemini-cli / Gemini Code Assist personal-OAuth path afk-coder currently uses.

Vertex ADC *is* Google OAuth in the broad sense — `gcloud auth application-default login` mints user
credentials, and a service-account key file works unattended, which is genuinely good for a daemon.
But it is a **Google Cloud** credential requiring a project and location, not the consumer
`oauth-personal` Google-account sign-in that afk-coder's `afk login` performs today.

### The consequence, stated plainly

Deleting `google-auth-library` **does** cost existing afk-coder users who authenticate with a
personal Google account and no API key. Those users must move to one of: a `GEMINI_API_KEY` from AI
Studio, a Google Cloud project with Vertex + ADC/service account, or a different provider entirely.
Users who already set `GEMINI_API_KEY` are unaffected — that exact env var is what Pi's `google`
provider reads.

There is a third option if that migration is unacceptable: Pi supports **extension-registered custom
providers with custom OAuth flows** ([`docs/custom-provider.md`](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)),
so a Google-personal-OAuth provider could be written as a Pi extension. That keeps the OAuth code
alive but moves it out of afk-coder's core into a pluggable unit — which still satisfies the stated
motive of not carrying provider concerns in afk-coder's code structure. **(inferred:** I read the
custom-provider doc's existence and the gitlab-duo example's file list, not the full extension
provider API.**)**

---

## 8. Not found in primary sources

- Whether `pi` exits with a distinct exit code (vs. generic failure) when non-interactive and no
  credential resolves. `auth-check.ts` gives structured statuses for `pi auth check`, but I did not
  trace the main CLI's failure path.
- Whether every OAuth provider's `toAuth()` yields a plain bearer token usable via an env var. Only
  verified for Anthropic (`toAuth` → `{ apiKey: credential.access }`).
- Whether GitHub Copilot's login actually uses the device-code flow. The file layout suggests it;
  I did not read `oauth/github-copilot.ts`.
- Concurrency behaviour of `auth.json` OAuth refresh across many *containers* (as opposed to many
  processes on one host sharing one file). The lock is a `lockfile.lockSync` on the file, so it
  cannot coordinate across separate container filesystems. **(inferred:** provision per-container
  credentials from the host rather than sharing one mounted `auth.json` across concurrent
  containers.**)**
- Whether `pi` respects `NO_COLOR`-style or TTY-detection differences that would affect
  `--mode json` output stability inside Docker. Not examined.
- Rate-limit / quota semantics per provider. Not covered by the docs I read.

---

## 9. What afk-coder's config schema still carries vs. what it delegates to Pi

| afk-coder must still own | Delegated entirely to Pi |
|---|---|
| **Which provider + model a workflow uses** — a `provider` / `model` pair (or a `--model provider/id:thinking` string) per workflow, with a daemon-level default. This is policy, and Pi has no opinion about afk-coder's workflows. | **The provider catalog.** ~35 built-in providers and their model lists, base URLs, wire APIs, and generated capability metadata. afk-coder never enumerates a provider again. |
| **Thinking/reasoning level** as a workflow knob (`off`…`max`), if exposed to users. Pi accepts it per invocation. | **Per-model capability metadata** — `reasoning`, `thinkingLevelMap`, `input` modalities, `contextWindow`, `maxTokens`, `cost` tiers, `samplingParams`, and every `compat` quirk (`supportsDeveloperRole`, `thinkingFormat`, `cacheControlFormat`, `forceAdaptiveThinking`, …). |
| **Where host credential state lives** — the path afk-coder treats as its Pi agent dir (`~/.config/afk-coder/pi` or plain `~/.pi/agent`), settable via `PI_CODING_AGENT_DIR`. | **Credential resolution order** — `--api-key` > `auth.json` > env var > `models.json` key, plus the "stored credential owns its provider" rule. |
| **How credentials cross the container boundary** — which of {env var, `--api-key`, injected `auth.json`, minted bearer, gateway} the daemon uses, and the bind-mount/tmpfs plumbing for it. | **OAuth login flows and token refresh**, including the loopback-callback / manual-paste / device-code mechanics, expiry margins, and cross-process refresh locking. Delete `google-auth-library` and `refreshToken()`. |
| **Sandbox image** — afk-coder now builds/pins its own Pi-based image instead of Google's `gemini-cli/sandbox`. Keep `sandbox.image`, `sandbox.memory`, `sandbox.nanoCpus`. | **The `auth.json` format and its `0600` handling**, and the `!command` / `$ENV` key indirection. afk-coder writes the documented shape; it does not invent one. |
| **Workspace mount point and cwd** (`/app` today, `/workspace` in Pi's own examples) — this is afk-coder's contract with its workflows. | **Config file discovery and precedence** — global `settings.json` vs project `.pi/settings.json`, `models.json`, `AGENTS.md`/`CLAUDE.md` walking, session dir resolution. |
| **Project-trust policy** — an explicit decision to pass `--approve` / `--no-approve` / set `defaultProjectTrust`, because headless runs silently ignore project-local Pi config by default. | **Token accounting and cost** — one `Usage` shape with normalized `input`/`output`/`cacheRead`/`cacheWrite`/`totalTokens` and computed per-category cost, across every provider. |
| **Which `pi` invocation mode to drive** (`--mode json` vs `--mode rpc` vs `-p`) and parsing that stream. | **Streaming event vocabulary, stop-reason normalization, error-as-event semantics, and cross-provider message translation** (foreign thinking blocks → `<thinking>` text). |
| **Preflight UX** — calling `pi auth check --json` and turning `not_ready` into a useful message. | **What "configured" means per provider** — ambient AWS/gcloud credential discovery, subscription vs API-key auth types, availability filtering in `getAvailable()`. |
| **Optional: a user-supplied `models.json` passthrough** if afk-coder wants to let users add Ollama/vLLM/proxies. Purely a file to place; no schema knowledge needed. | **Everything a custom provider needs to work** once that file exists — API dispatch, compat flags, key resolution, availability checks. |

**Fields that can be deleted outright from `src/common/config.ts`:** the whole `auth` block
(`clientId`, `clientSecret`, `scopes`, `redirectUri`) and the `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` plumbing that feeds it. `daemon.agent: 'gemini'` becomes either a Pi
provider/model pair or disappears. `sandbox.image` stays but points at an afk-coder-built Pi image.

**Net:** provider variance leaves afk-coder's code entirely. What remains is a
provider-and-model *selection* field, a credential *transport* decision for the container, and the
sandbox plumbing afk-coder already owns for other reasons.
