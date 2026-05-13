/**
 * Shared utilities for OpenAI-compatible LLM providers.
 * Extracted to avoid duplication across openai, qwen, openrouter, custom-openai.
 */

/**
 * Convert messages with images to OpenAI multimodal format.
 */
export function formatMultimodal(messages, opts = {}) {
  return messages.map((msg) => {
    if (!msg.images?.length) {
      const formatted = { role: msg.role, content: msg.content };
      if (msg.tool_call_id) formatted.tool_call_id = msg.tool_call_id;
      if (msg.name) formatted.name = msg.name;
      if (opts.includeReasoningContent && msg.role === 'assistant') {
        const reasoningContent = msg.reasoning_content || msg.thinking;
        if (reasoningContent) formatted.reasoning_content = reasoningContent;
      }
      if (msg.tool_calls?.length) {
        formatted.tool_calls = msg.tool_calls.map((tc) => {
          if (tc.type === 'function' && tc.function) return tc;
          return {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.arguments || '{}',
            },
          };
        });
      }
      return formatted;
    }
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
 * Convert internal function schemas to OpenAI-compatible tool objects.
 * Internal tools are { name, description, parameters }; OpenAI-compatible
 * chat completions APIs expect { type: 'function', function: ... }.
 */
export function formatOpenAITools(tools = []) {
  return tools.map((tool) => {
    if (tool.type === 'function' && tool.function) return tool;
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  });
}

/**
 * Parse OpenAI-style SSE stream and yield content/reasoning/tool_calls deltas.
 * Yields: { content, reasoning, toolCalls } where toolCalls is an array of
 * { id, name, arguments (string chunk) } fragments that must be assembled.
 * When the final chunk includes usage data (stream_options: { include_usage: true }),
 * yields { usage: { prompt_tokens, completion_tokens, total_tokens } } instead.
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

          // Usage data in final chunk (when stream_options.include_usage = true)
          if (json.usage) {
            yield { usage: json.usage };
            continue;
          }

          const delta = json.choices?.[0]?.delta;
          if (!delta) continue;

          const content = delta.content || null;
          const reasoning = delta.reasoning_content || null;

          // Parse tool call fragments
          let toolCalls = null;
          if (delta.tool_calls?.length) {
            toolCalls = delta.tool_calls.map((tc) => ({
              index: tc.index ?? 0,
              id: tc.id || null,
              name: tc.function?.name || null,
              arguments: tc.function?.arguments || null,
            }));
          }

          if (content || reasoning || toolCalls) {
            yield { content, reasoning, toolCalls };
          }
        } catch {
          // skip malformed JSON lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
