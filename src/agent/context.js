/**
 * Context Assembly — sliding window + summary for conversation context.
 *
 * Inspired by Hermes Agent's ContextCompressor.
 *
 * Strategy:
 * - Head protection: always keep system prompt + first 2 user/assistant exchanges
 * - Sliding window: keep the most recent N messages (default ~20)
 * - Summary injection: if messages were dropped between head and tail,
 *   call llm.completeSession() to generate a summary, inject before tail
 *
 * Usage:
 *   import { buildContext } from './agent/context';
 *   const { messages, systemPrompt } = await buildContext({
 *     messages: sessionMessages,
 *     systemPrompt: baseSystemPrompt,
 *     memorySnapshot: { memory, user },
 *     skillsList: '...',
 *   });
 */

import llm from '../models/llm';

// ─── Configuration ───────────────────────────────────────────────────────────

const CONTEXT_WINDOW_FALLBACK = 128_000; // fallback if model unknown
const COMPRESSION_THRESHOLD_RATIO = 0.5; // compress when over 50% of window
const HEAD_PROTECT = 4; // protect first 4 messages (system + first 2 exchanges)
const TAIL_KEEP = 20; // keep last 20 messages in the tail
const TOKENS_PER_CHAR = 4; // rough char-to-token ratio

/**
 * Build the API messages and system prompt with context management.
 *
 * @param {Object} opts
 * @param {Array} opts.messages - Full conversation history
 * @param {string} opts.systemPrompt - Base system prompt (core instructions)
 * @param {{ memory: string|null, user: string|null }} [opts.memorySnapshot]
 * @param {string} [opts.skillsList] - Pre-built skills section
 * @param {string} [opts.agentIdentity] - AGENTS.md content for agent identity
 * @param {number} [opts.contextWindow] - Model context window size
 * @param {boolean} [opts.forceCompress] - Force compression regardless of token count
 * @returns {Promise<{ messages: Array, systemPrompt: string, compressed: boolean }>}
 */
export async function buildContext(opts) {
  const {
    messages,
    systemPrompt = '',
    memorySnapshot,
    skillsList = '',
    agentIdentity = null,
    contextWindow = CONTEXT_WINDOW_FALLBACK,
    forceCompress = false,
  } = opts;

  // Build full system prompt
  let fullSystemPrompt = systemPrompt;
  if (agentIdentity) fullSystemPrompt += '\n\n' + buildAgentIdentitySection(agentIdentity);
  if (memorySnapshot) {
    const memorySection = buildMemorySection(memorySnapshot);
    if (memorySection) fullSystemPrompt += '\n\n' + memorySection;
  }
  if (skillsList) fullSystemPrompt += skillsList;

  // Estimate token usage
  const estimatedTokens = estimateTokens(messages, fullSystemPrompt);
  const threshold = Math.floor(contextWindow * COMPRESSION_THRESHOLD_RATIO);

  if (!forceCompress && estimatedTokens < threshold) {
    // No compression needed — just pass through
    return { messages, systemPrompt: fullSystemPrompt, compressed: false };
  }

  // Compress: head + summary + tail
  const result = compress(messages, fullSystemPrompt);
  return {
    messages: result.messages,
    systemPrompt: result.systemPrompt,
    compressed: true,
  };
}

/**
 * Compress messages using sliding window + summary.
 */
function compress(messages, systemPrompt) {
  if (messages.length <= HEAD_PROTECT + TAIL_KEEP) {
    return { messages, systemPrompt, compressed: false };
  }

  // Head: first HEAD_PROTECT messages
  const head = messages.slice(0, HEAD_PROTECT);
  // Tail: last TAIL_KEEP messages
  const tail = messages.slice(-TAIL_KEEP);
  // Middle: everything between head and tail
  const middle = messages.slice(HEAD_PROTECT, -TAIL_KEEP);

  // Mark the middle for summary
  const compressedMessages = [...head, ...tail];

  // Annotate the system prompt with a note about compression
  const compressionNote =
    '\n\n[Context note: Earlier conversation turns have been summarized. ' +
    `The following ${middle.length} turns were compressed to manage context.]`;

  return {
    messages: compressedMessages,
    systemPrompt: systemPrompt + compressionNote,
    compressed: true,
    middle,
  };
}

/**
 * Generate a summary of dropped messages and inject it into the conversation.
 * This should be called after compress() to fill in the middle summary.
 *
 * @param {Array} middleMessages - Messages to summarize
 * @param {string} existingSummary - Previous summary (for update mode)
 * @returns {Promise<string>}
 */
export async function summarizeMiddle(middleMessages, existingSummary) {
  if (middleMessages.length === 0) return '';

  const prompt = existingSummary
    ? `You previously summarized this conversation:\n${existingSummary}\n\n` +
      `UPDATE this summary with the following additional turns. ` +
      `Focus on: active tasks, key decisions, resolved items, pending user asks. ` +
      `Keep it concise.\n\nNew turns:\n${formatMessages(middleMessages)}`
    : `Summarize the following conversation turns in a concise format. ` +
      `Include: active task, completed actions, key decisions, pending items. ` +
      `Keep it to 1-2 short paragraphs.\n\n` +
      formatMessages(middleMessages);

  try {
    const summary = await llm.completeSession(
      [{ role: 'user', content: prompt }],
      { maxTokens: 300 }
    );
    return summary.trim();
  } catch (err) {
    console.warn('Context summar failed:', err.message);
    return `[${middleMessages.length} turns summarized: see earlier conversation for details]`;
  }
}

/**
 * Build a context-aware message list for the LLM API.
 * Combines context assembly with tool schemas and memory injection.
 *
 * @param {Object} opts
 * @param {Array} opts.messages - Full conversation history
 * @param {string} opts.systemPrompt - Base system prompt
 * @param {string} [opts.summary] - Pre-computed summary of dropped messages
 * @param {{ memory: string|null, user: string|null }} [opts.memorySnapshot]
 * @param {string} [opts.skillsList]
 * @param {string} [opts.agentIdentity] - AGENTS.md content for agent identity
 * @param {number} [opts.contextWindow]
 * @returns {Promise<{ apiMessages: Array, systemPrompt: string }>}
 */
export async function assembleApiMessages(opts) {
  const {
    messages,
    systemPrompt,
    summary,
    memorySnapshot,
    skillsList,
    agentIdentity = null,
    contextWindow,
  } = opts;

  // Build full system prompt
  let fullSystemPrompt = systemPrompt;
  if (agentIdentity) fullSystemPrompt += '\n\n' + buildAgentIdentitySection(agentIdentity);
  if (memorySnapshot) {
    const memorySection = buildMemorySection(memorySnapshot);
    if (memorySection) fullSystemPrompt += '\n\n' + memorySection;
  }
  if (skillsList) fullSystemPrompt += skillsList;

  // Estimate and decide on compression
  const estimatedTokens = estimateTokens(messages, fullSystemPrompt);
  const threshold = Math.floor(
    (contextWindow || CONTEXT_WINDOW_FALLBACK) * COMPRESSION_THRESHOLD_RATIO
  );

  if (estimatedTokens < threshold) {
    return { apiMessages: [...messages], systemPrompt: fullSystemPrompt };
  }

  // Compress: head + tail
  const headCount = Math.min(HEAD_PROTECT, messages.length);
  const head = messages.slice(0, headCount);
  const tailCount = Math.min(TAIL_KEEP, messages.length - headCount);
  const tail = messages.slice(-tailCount);

  let apiMessages = [...head, ...tail];

  // Inject summary if available
  if (summary) {
    const summaryMsg = {
      role: 'system',
      content: `[Conversation Summary]\n${summary}`,
    };
    // Insert between head and tail
    apiMessages = [...head, summaryMsg, ...tail];
  }

  return { apiMessages, systemPrompt: fullSystemPrompt };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Estimate tokens from character count. */
function estimateTokens(messages, systemPrompt) {
  let total = systemPrompt ? systemPrompt.length : 0;
  for (const msg of messages) {
    if (msg.content) total += msg.content.length;
    if (msg.thinking) total += msg.thinking.length;
    if (msg.reasoning_content) total += msg.reasoning_content.length;
    if (msg.tool_calls) total += JSON.stringify(msg.tool_calls).length;
    if (msg.name) total += msg.name.length;
  }
  return Math.floor(total / TOKENS_PER_CHAR);
}

/** Format messages as a readable string for summarization. */
function formatMessages(messages) {
  return messages
    .map((m) => {
      const role = m.role || m.tool_call_id ? 'tool' : m.role;
      return `[${role}] ${m.content || ''}`;
    })
    .join('\n');
}

/** Build the memory section for system prompt injection. */
function buildMemorySection(snapshot) {
  if (!snapshot) return '';
  let out = '';
  if (snapshot.memory) {
    out += `<memory_notes>\n${snapshot.memory}\n</memory_notes>\n\n`;
  }
  if (snapshot.user) {
    out += `<user_profile>\n${snapshot.user}\n</user_profile>\n\n`;
  }
  return out;
}

/** Build the agent identity section from AGENTS.md content. */
function buildAgentIdentitySection(content) {
  return `<agent_identity>\n${content.trim()}\n</agent_identity>`;
}
