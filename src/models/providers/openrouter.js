/**
 * OpenRouter provider.
 * Uses the OpenRouter API (OpenAI-compatible) to access many models.
 */

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

const MODELS = [
  { id: 'openai/gpt-4o', name: 'GPT-4o (via OpenRouter)' },
  { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4 (via OpenRouter)' },
  { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (via OpenRouter)' },
  { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick (via OpenRouter)' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (via OpenRouter)' },
  { id: 'qwen/qwen3-235b-a22b', name: 'Qwen3 235B (via OpenRouter)' },
];

export default {
  id: 'openrouter',
  name: 'OpenRouter',
  fallbackModels: MODELS,
  defaultModel: 'openai/gpt-4o',
  defaultBaseUrl: DEFAULT_BASE_URL,

  /**
   * Fetch available models from the OpenRouter API.
   * @param {Object} config - { apiKey, baseUrl? }
   * @returns {Promise<Array<{ id, name }>>}
   */
  async listModels(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    });
    if (!res.ok) throw new Error(`OpenRouter models error ${res.status}`);
    const json = await res.json();
    return (json.data || [])
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((m) => ({ id: m.id, name: m.name || m.id }));
  },

  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'HTTP-Referer': globalThis.location?.href || 'https://vertex-agent.local',
        'X-Title': 'Vertex Agent',
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
      throw new Error(`OpenRouter error ${res.status}: ${err}`);
    }

    yield* readSSE(res.body);
  },
};

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
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
