/**
 * Google Gemini provider.
 * Uses the Gemini REST API with streaming (generateContent stream).
 */

const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
];

export default {
  id: 'gemini',
  name: 'Google Gemini',
  fallbackModels: MODELS,
  defaultModel: 'gemini-2.5-flash',
  defaultBaseUrl: DEFAULT_BASE_URL,

  /**
   * Fetch available models from the Gemini API.
   * @param {Object} config - { apiKey, baseUrl? }
   * @returns {Promise<Array<{ id, name }>>}
   */
  async listModels(config) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/models?key=${config.apiKey}`);
    if (!res.ok) throw new Error(`Gemini models error ${res.status}`);
    const json = await res.json();
    return (json.models || [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => {
        const id = m.name.replace('models/', '');
        return { id, name: m.displayName || id };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  },

  async *stream(config, messages, opts = {}) {
    const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    const model = config.model || this.defaultModel;

    // Convert OpenAI-style messages to Gemini format
    let systemInstruction = undefined;
    const contents = [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        const parts = [];
        if (msg.images?.length) {
          for (const img of msg.images) {
            const [header, data] = img.dataUrl.split(',');
            const mimeType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
            parts.push({ inline_data: { mime_type: mimeType, data } });
          }
        }
        if (msg.content) parts.push({ text: msg.content });
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: parts.length > 0 ? parts : [{ text: '' }],
        });
      }
    }

    const res = await fetch(
      `${baseUrl}/models/${model}:streamGenerateContent?alt=sse&key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          ...(systemInstruction && { systemInstruction }),
          generationConfig: {
            ...(opts.temperature != null && { temperature: opts.temperature }),
            ...(opts.maxTokens != null && { maxOutputTokens: opts.maxTokens }),
          },
        }),
        signal: opts.signal,
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini error ${res.status}: ${err}`);
    }

    yield* readGeminiSSE(res.body);
  },
};

async function* readGeminiSSE(body) {
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
          const part = json.candidates?.[0]?.content?.parts?.[0];
          if (part) {
            const isThought = part.thought === true;
            if (isThought && part.text) {
              yield { content: null, reasoning: part.text };
            } else if (part.text) {
              yield { content: part.text, reasoning: null };
            }
          }
        } catch {
          // skip
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
