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

  /**
   * Fetch available models from the custom endpoint.
   * @param {Object} config - { apiKey, baseUrl }
   * @returns {Promise<Array<{ id, name }>>}
   */
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

  /**
   * Send a chat completion request with streaming.
   * @param {Object} config  - { apiKey, baseUrl, model }
   * @param {Array}  messages - [{ role, content }]
   * @param {Object} opts     - { signal?, temperature?, maxTokens? }
   * @returns {AsyncGenerator<string>} yields content delta strings
   */
  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) throw new Error('Base URL is required for Custom OpenAI-compatible provider.');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: formatMultimodal(messages),
        stream: true,
        ...(opts.temperature != null && { temperature: opts.temperature }),
        ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Custom endpoint error ${res.status}: ${err}`);
    }

    yield* readSSE(res.body);
  },
};

/**
 * Convert messages with images to OpenAI multimodal format.
 */
function formatMultimodal(messages) {
  return messages.map((msg) => {
    if (!msg.images?.length) return { role: msg.role, content: msg.content };
    return {
      role: msg.role,
      content: [
        ...msg.images.map((img) => ({ type: 'image_url', image_url: { url: img.dataUrl } })),
        ...(msg.content ? [{ type: 'text', text: msg.content }] : []),
      ],
    };
  });
}

/**
 * Parse OpenAI-style SSE stream and yield content deltas.
 */
async function* readSSE(body) {
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
        if (data === '[DONE]') return;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta;
          const content = delta?.content || null;
          const reasoning = delta?.reasoning_content || null;
          if (content || reasoning) yield { content, reasoning };
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
