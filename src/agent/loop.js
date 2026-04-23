/**
 * Agent Running Loop — multi-turn tool execution engine.
 *
 * Inspired by Hermes Agent's run_conversation() loop.
 *
 * Flow:
 * 1. Build context (apply sliding window + tool schemas + memory + skills)
 * 2. Stream LLM response with tool schemas
 * 3. Extract tool calls from response
 * 4. If tool calls: execute them, append results, go to step 2
 * 5. If no tool calls: loop ends, return final response
 * 6. Max rounds: configurable (default 10)
 *
 * Usage:
 *   import { runAgentLoop } from './agent/loop';
 *
 *   const result = await runAgentLoop({
 *     messages: chatMessages,
 *     systemPrompt: basePrompt,
 *     agentUrl: 'http://localhost:3099',
 *     onUpdate: ({ content, thinking, toolCalls }) => { ... },
 *     signal: controller.signal,
 *   });
 *   // result.content, result.thinking, result.toolCalls
 */

import llm from '../models/llm';
import { registry } from './tools.js';
import { assembleApiMessages } from './context.js';
import { loadMemory } from './memory.js';
import { buildSkillsSection } from './skills.js';

const DEFAULT_MAX_ROUNDS = 10;

/**
 * Run the agent loop for a chat.
 *
 * @param {Object} opts
 * @param {Array} opts.messages - Current chat messages
 * @param {string} opts.systemPrompt - Base system prompt
 * @param {string} [opts.agentUrl] - Agent server URL (null if no agent)
 * @param {Function} [opts.onUpdate] - Callback for streaming updates
 * @param {AbortSignal} [opts.signal] - Abort signal for cancellation
 * @param {number} [opts.maxRounds] - Max tool execution rounds (default 10)
 * @param {string} [opts.provider] - Provider id for context window estimation
 * @returns {Promise<{ content: string, thinking: string, toolCalls: Array }>}
 */
export async function runAgentLoop(opts) {
  const {
    messages,
    systemPrompt,
    agentUrl = null,
    onUpdate = () => {},
    signal = null,
    maxRounds = DEFAULT_MAX_ROUNDS,
  } = opts;

  // Load memory snapshot (frozen for this session)
  const memorySnapshot = await loadMemory();
  // Load skills list
  const skillsList = await buildSkillsSection();

  // Context window by provider
  const contextWindow = getContextWindow(opts.provider);

  // Track accumulated tool calls for this agent loop invocation
  const allToolCalls = {}; // id -> { id, name, status, result? }
  let finalContent = '';
  let finalThinking = '';

  // Build the API messages with context management
  let { apiMessages, systemPrompt: finalSystemPrompt } =
    await assembleApiMessages({
      messages,
      systemPrompt,
      memorySnapshot,
      skillsList,
      contextWindow,
    });

  // Get tool schemas (filter by availability)
  const toolSchemas = getAvailableToolSchemas(agentUrl);

  for (let round = 0; round <= maxRounds; round++) {
    // Stream LLM response
    const { content, thinking, toolCalls } = await streamAndCollect(
      apiMessages,
      finalSystemPrompt,
      toolSchemas,
      { signal, onUpdate }
    );

    finalContent = content;
    finalThinking = thinking;

    // No tool calls — we're done
    if (!toolCalls || toolCalls.length === 0) {
      break;
    }

    // Record tool calls by id (deduplicate)
    for (const tc of toolCalls) {
      allToolCalls[tc.id] = { id: tc.id, name: tc.name, status: 'running' };
    }

    // Execute tool calls and build results
    const toolResults = [];
    for (const tc of toolCalls) {
      try {
        const result = await registry.dispatch(tc.name, tc.parsedArgs, {
          agentUrl,
        });
        const resultStr = String(result);
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: resultStr,
        });
        // Update tracking with result
        if (allToolCalls[tc.id]) {
          allToolCalls[tc.id].status = 'completed';
          allToolCalls[tc.id].result = resultStr;
        }
      } catch (err) {
        const errStr = `Error: ${err.message}`;
        toolResults.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: errStr,
        });
        if (allToolCalls[tc.id]) {
          allToolCalls[tc.id].status = 'error';
          allToolCalls[tc.id].result = errStr;
        }
      }
    }

    // Notify UI of tool results (as array)
    onUpdate({ content, thinking, toolCalls: Object.values(allToolCalls) });

    // Append assistant message and tool results to apiMessages
    apiMessages = [
      ...apiMessages,
      { role: 'assistant', content },
      ...toolResults,
    ];

    // Continue loop — but first check if context needs compression
    const ctxResult = await assembleApiMessages({
      messages: apiMessages,
      systemPrompt: systemPrompt,
      memorySnapshot,
      skillsList,
      contextWindow,
    });
    apiMessages = ctxResult.apiMessages;
    finalSystemPrompt = ctxResult.systemPrompt;
  }

  return { content: finalContent, thinking: finalThinking, toolCalls: Object.values(allToolCalls) };
}

/**
 * Stream LLM response and collect all content + tool calls.
 *
 * @param {Array} apiMessages
 * @param {string} systemPrompt
 * @param {Array} toolSchemas
 * @param {Object} opts - { signal, onUpdate }
 * @returns {Promise<{ content: string, thinking: string, toolCalls: Array|null, completed: boolean }>}
 */
async function streamAndCollect(apiMessages, systemPrompt, toolSchemas, opts) {
  let content = '';
  let thinking = '';
  const toolCallFragments = []; // { id, name, arguments }

  try {
    const chatOpts = {
      signal: opts.signal,
    };

    // Add tool schemas if available
    if (toolSchemas?.length) {
      chatOpts.tools = toolSchemas;
    }

    // Add system prompt
    if (systemPrompt) {
      chatOpts.systemPrompt = systemPrompt;
    }

    for await (const chunk of llm.chat(apiMessages, chatOpts)) {
      if (typeof chunk === 'string') {
        content += chunk;
        opts.onUpdate?.({ content, thinking, toolCalls: null });
      } else {
        if (chunk.content) {
          content += chunk.content;
        }
        if (chunk.reasoning) {
          thinking += chunk.reasoning;
        }
        if (chunk.toolCalls) {
          for (const tc of chunk.toolCalls) {
            // Merge fragments by index
            mergeToolFragment(toolCallFragments, tc);
          }
        }
        opts.onUpdate?.({
          content,
          thinking,
          toolCalls: toolCallFragments.map((f) => ({ id: f.id || '', name: f.name })),
        });
      }
    }

    // Parse complete tool calls from fragments
    const completedToolCalls = finalizeToolCalls(toolCallFragments);

    return {
      content,
      thinking,
      toolCalls: completedToolCalls,
      completed: !completedToolCalls?.length,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { content, thinking, toolCalls: null, completed: true };
    }
    throw err;
  }
}

/**
 * Merge a tool call fragment into the accumulator.
 * Handles both OpenAI-style (index-based) and Anthropic-style fragments.
 */
function mergeToolFragment(accumulator, fragment) {
  const idx = fragment.index ?? 0;

  if (!accumulator[idx]) {
    accumulator[idx] = { id: '', name: '', arguments: '' };
  }

  const existing = accumulator[idx];
  if (fragment.id) existing.id = fragment.id;
  if (fragment.name) existing.name = fragment.name;
  if (fragment.arguments) existing.arguments += fragment.arguments;
}

/**
 * Finalize accumulated tool call fragments into complete tool calls.
 */
function finalizeToolCalls(fragments) {
  const results = [];
  for (const f of Object.values(fragments)) {
    if (!f.name) continue;
    let parsedArgs = {};
    try {
      parsedArgs = f.arguments ? JSON.parse(f.arguments) : {};
    } catch {
      // If arguments are incomplete JSON, try to parse as much as possible
      parsedArgs = { _raw: f.arguments };
    }
    results.push({
      id: f.id || `tc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      parsedArgs,
      rawArgs: f.arguments,
    });
  }
  return results.length > 0 ? results : null;
}

/**
 * Get available tool schemas filtered by availability.
 */
function getAvailableToolSchemas(agentUrl) {
  const context = { agentUrl };
  return registry
    .getAll()
    .filter((t) => !t.checkAvailable || t.checkAvailable(context))
    .map((t) => ({
      name: t.name,
      description: t.schema.description,
      parameters: t.schema.parameters,
    }));
}

/**
 * Estimate context window size by provider/model.
 * Falls back to a conservative default.
 */
function getContextWindow(provider) {
  // Rough estimates based on common models
  const WINDOWS = {
    anthropic: 200_000,
    openai: 128_000,
    gemini: 1_000_000,
    openrouter: 128_000,
    qwen: 32_000,
    'custom-openai': 128_000,
  };
  return WINDOWS[provider] || 128_000;
}
