import { formatMultimodal, formatOpenAITools, readSSE } from './shared.js';

/**
 * Qwen / Aliyun DashScope provider.
 * Uses the DashScope OpenAI-compatible API endpoint.
 */

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const MODELS = [
  { id: 'qwen-max', name: 'Qwen Max' },
  { id: 'qwen-plus', name: 'Qwen Plus' },
  { id: 'qwen-turbo', name: 'Qwen Turbo' },
  { id: 'qwen3-235b-a22b', name: 'Qwen3 235B' },
  { id: 'qwen3-32b', name: 'Qwen3 32B' },
  { id: 'qwen3-30b-a3b', name: 'Qwen3 30B' },
];

export default {
  id: 'qwen',
  name: 'Qwen (Aliyun)',
  fallbackModels: MODELS,
  defaultModel: 'qwen-plus',
  defaultBaseUrl: DEFAULT_BASE_URL,

  async listModels(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`Qwen models error ${res.status}`);
    const json = await res.json();
    return (json.data || [])
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

    // Tool calling support — Qwen DashScope uses OpenAI-style tool format
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
      throw new Error(`Qwen error ${res.status}: ${err}`);
    }

    yield* readSSE(res.body);
  },
};
