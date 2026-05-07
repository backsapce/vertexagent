import { formatMultimodal, formatOpenAITools, readSSE } from './shared.js';

/**
 * DeepSeek OpenAI-compatible provider.
 * Official base URL: https://api.deepseek.com
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com';

const MODELS = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'deepseek-chat', name: 'DeepSeek Chat' },
  { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner' },
];

export default {
  id: 'deepseek',
  name: 'DeepSeek',
  fallbackModels: MODELS,
  defaultModel: 'deepseek-chat',
  defaultBaseUrl: DEFAULT_BASE_URL,

  async listModels(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`DeepSeek models error ${res.status}`);
    const json = await res.json();
    return (json.data || [])
      .filter((m) => m.id)
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

    if (opts.tools?.length) {
      body.tools = formatOpenAITools(opts.tools);
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
      throw new Error(`DeepSeek error ${res.status}: ${err}`);
    }

    yield* readSSE(res.body);
  },
};
