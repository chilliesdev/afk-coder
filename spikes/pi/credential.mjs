// Pick whatever provider credential the host happens to have. The spike is not
// the place to encode a provider choice — #62 owns that.
//
// Note: keys live in ~/.zshrc, which only an *interactive* zsh sources. Run the
// spikes as `zsh -ic 'node spikes/pi/run-rpc.mjs'` or export the var yourself.
const PROVIDER_ENV = {
  deepseek: 'DEEPSEEK_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
};

export function resolveCredential() {
  const forced = process.env.PI_PROVIDER;
  const order = forced ? [forced] : Object.keys(PROVIDER_ENV);
  for (const provider of order) {
    const envVar = PROVIDER_ENV[provider];
    const value = envVar && process.env[envVar];
    if (value) return { provider, envVar, value, model: process.env.PI_MODEL ?? '' };
  }
  return null;
}

// No credential: still exercise the failure paths by forcing a turn that
// reaches a provider and 401s. --api-key requires an explicit --model.
export const FAKE = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-5',
  key: 'sk-ant-api03-deliberately-invalid',
};
