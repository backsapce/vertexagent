/**
 * Anthropic (Claude) provider.
 * Uses the Anthropic Messages API with streaming.
 */

const DEFAULT_BASE_URL = 'https://api.anthropic.com';

const MODELS = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet' },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
];

export default {
  id: 'anthropic',
  name: 'Anthropic',
  fallbackModels: MODELS,
  defaultModel: 'claude-sonnet-4-20250514',
  defaultBaseUrl: DEFAULT_BASE_URL,

  /**
   * Fetch available models from the Anthropic API.
   * @param {Object} config - { apiKey, baseUrl? }
   * @returns {Promise<Array<{ id, name }>>}
   */
  async listModels(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: {
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) throw new Error(`Anthropic models error ${res.status}`);
    const json = await res.json();
    return (json.data || [])
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, name: m.display_name || m.id }));
  },

  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');

    // Anthropic uses a separate system message
    let system = undefined;
    const apiMessages = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        system = msg.content;
      } else if (msg.images?.length) {
        const parts = msg.images.map((img) => {
          const [header, data] = img.dataUrl.split(',');
          const mediaType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
          return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
        });
        if (msg.content) parts.push({ type: 'text', text: msg.content });
        apiMessages.push({ role: msg.role, content: parts });
      } else {
        apiMessages.push({ role: msg.role, content: msg.content });
      }
    }

    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model || this.defaultModel,
        messages: apiMessages,
        ...(system && { system }),
        max_tokens: opts.maxTokens || 4096,
        stream: true,
        ...(opts.temperature != null && { temperature: opts.temperature }),
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${err}`);
    }

    yield* readAnthropicSSE(res.body);
  },
};

async function* readAnthropicSSE(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();

        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta') {
            if (json.delta?.type === 'thinking_delta' && json.delta?.thinking) {
              yield { content: null, reasoning: json.delta.thinking };
            } else if (json.delta?.text) {
              yield { content: json.delta.text, reasoning: null };
            }
          }
          if (json.type === 'message_stop') return;
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
