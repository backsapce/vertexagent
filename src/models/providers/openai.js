/**
 * OpenAI-compatible provider.
 * Works with OpenAI API and any OpenAI-compatible endpoint (e.g. local proxies).
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

  /**
   * Fetch available models from the API.
   * @param {Object} config - { apiKey, baseUrl? }
   * @returns {Promise<Array<{ id, name }>>}
   */
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

  /**
   * Send a chat completion request with streaming.
   * @param {Object} config  - { apiKey, baseUrl?, model }
   * @param {Array}  messages - [{ role, content }]
   * @param {Object} opts     - { signal?, temperature?, maxTokens? }
   * @returns {AsyncGenerator<string>} yields content delta strings
   */
  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || this.defaultModel,
        messages: formatMultimodal(messages),
        stream: true,
        ...(opts.temperature != null && { temperature: opts.temperature }),
        ...(opts.maxTokens != null && { max_tokens: opts.maxTokens }),
      }),
      signal: opts.signal,
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err}`);
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
