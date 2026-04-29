import { formatMultimodal, readSSE } from './shared.js';

/**
 * Custom OpenAI-compatible provider.
 * Works with any OpenAI-compatible API endpoint.
 * Requires user to provide Base URL, API Key, and Model name.
 */

const MODELS = [];

export default {
  id: 'custom-openai',
  name: 'Custom OpenAI-compatible',
  fallbackModels: MODELS,
  defaultModel: '',
  defaultBaseUrl: '',
  requiresBaseUrl: true,

  async listModels(config) {
    const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) return [];
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`Custom endpoint models error ${res.status}`);
    const json = await res.json();
    return (json.data || [])
      .sort((a, b) => (a.id || '').localeCompare(b.id || ''))
      .map((m) => ({ id: m.id, name: m.id }));
  },

  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Base URL is required for Custom OpenAI-compatible provider.');
    const body = {
      model: config.model,
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
      throw new Error(`Custom endpoint error ${res.status}: ${err}`);
    }

    yield* readSSE(res.body);
  },
};