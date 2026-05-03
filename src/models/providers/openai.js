import { formatMultimodal, readSSE } from './shared.js';

/**
 * OpenAI-compatible provider.
 * Works with OpenAI API and any OpenAI-compatible endpoint (e.g. local proxies).
 * Supports native function/tool calling.
 */

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

const MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
  { id: 'gpt-4.1', name: 'GPT-4.1' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
  { id: 'o3-mini', name: 'o3-mini' },
];

export default {
  id: 'openai',
  name: 'OpenAI',
  fallbackModels: MODELS,
  defaultModel: 'gpt-4o-mini',
  defaultBaseUrl: DEFAULT_BASE_URL,

  async listModels(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenAI models error ${res.status}`);
    const json = await res.json();
    return (json.data || [])
      .filter((m) => m.id && (m.id.startsWith('gpt') || m.id.startsWith('o') || m.id.startsWith('chatgpt')))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, name: m.id }));
  },

  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const body = {
      model: config.model || this.defaultModel,
      messages: formatMultimodal(messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(opts.temperature != null && { temperature: opts.temperature }),
      ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
    };

    // Tool calling support
    if (opts.tools?.length) {
      body.tools = opts.tools;
    }

    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err}`);
    }

    yield* readSSE(res.body);
  },
};
