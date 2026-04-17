/**
 * Shared utilities for OpenAI-compatible LLM providers.
 * Extracted to avoid duplication across openai, qwen, openrouter, custom-openai.
 */

/**
 * Convert messages with images to OpenAI multimodal format.
 */
export function formatMultimodal(messages) {
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
 * Parse OpenAI-style SSE stream and yield content/reasoning deltas.
 */
export async function* readSSE(body) {
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