/**
 * Unified LLM Service for Vertex Agent.
 *
 * Provides a single API surface for the chat UI regardless of which
 * provider is selected. Supports streaming responses.
 *
 * Usage:
 *   import llm from './models/llm';
 *
 *   // Configure once
 *   llm.configure({ provider: 'openai', apiKey: 'sk-...', model: 'gpt-4o' });
 *
 *   // Stream a response
 *   for await (const chunk of llm.chat(messages)) {
 *     process.stdout.write(chunk);
 *   }
 */

import openai from './providers/openai.js';
import anthropic from './providers/anthropic.js';
import gemini from './providers/gemini.js';
import openrouter from './providers/openrouter.js';
import qwen from './providers/qwen.js';
import customOpenai from './providers/custom-openai.js';
import { loadSettings, saveSettings } from './settings.js';

// ─── Provider registry ──────────────────────────────────────────────────────

const providers = {
  openai,
  anthropic,
  gemini,
  openrouter,
  qwen,
  'custom-openai': customOpenai,
};

// ─── Active config (in-memory) ──────────────────────────────────────────────

let activeConfig = {
  provider: null,   // provider id string
  apiKey: null,
  baseUrl: null,    // optional override
  model: null,      // model id or null for default
};

// ─── Public API ─────────────────────────────────────────────────────────────

const llm = {
  /**
   * List all registered providers with their metadata and models.
   * @returns {Array<{ id, name, models, defaultModel }>}
   */
  getProviders() {
    return Object.values(providers).map((p) => ({
      id: p.id,
      name: p.name,
      fallbackModels: p.fallbackModels,
      defaultModel: p.defaultModel,
      defaultBaseUrl: p.defaultBaseUrl,
      requiresBaseUrl: p.requiresBaseUrl || false,
    }));
  },

  /**
   * Get the currently active provider and model info.
   * @returns {{ provider, model, configured }}
   */
  getActiveConfig() {
    const p = providers[activeConfig.provider];
    return {
      provider: activeConfig.provider,
      model: activeConfig.model || p?.defaultModel || null,
      baseUrl: activeConfig.baseUrl,
      configured: !!(activeConfig.provider && activeConfig.apiKey),
      hasApiKey: !!activeConfig.apiKey,
    };
  },

  /**
   * Fetch model list from a provider's API.
   * Falls back to hardcoded fallbackModels on error.
   * @param {string} providerId
   * @param {Object} config - { apiKey, baseUrl? }
   * @returns {Promise<Array<{ id, name }>>}
   */
  async fetchModels(providerId, config) {
    const provider = providers[providerId];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    // Use saved API key as fallback when none is explicitly provided
    const apiKey = config.apiKey || activeConfig.apiKey;
    if (!apiKey) return provider.fallbackModels;
    try {
      const models = await provider.listModels({ ...config, apiKey });
      return models.length > 0 ? models : provider.fallbackModels;
    } catch (err) {
      console.warn(`Failed to fetch models from ${provider.name}:`, err.message);
      return provider.fallbackModels;
    }
  },

  /**
   * Configure the active provider.
   * @param {Object} cfg - { provider, apiKey, baseUrl?, model? }
   */
  async configure(cfg) {
    if (cfg.provider && !providers[cfg.provider]) {
      throw new Error(`Unknown provider: ${cfg.provider}`);
    }

    activeConfig = { ...activeConfig, ...cfg };

    // Persist to OPFS
    await saveSettings({
      provider: activeConfig.provider,
      apiKey: activeConfig.apiKey,
      baseUrl: activeConfig.baseUrl,
      model: activeConfig.model,
    });
  },

  /**
   * Load persisted settings from OPFS (call once at app startup).
   */
  async init() {
    const saved = await loadSettings();
    if (saved) {
      activeConfig = { ...activeConfig, ...saved };
    }
    return llm.getActiveConfig();
  },

  /**
   * Send a chat request and return an async generator of content chunks.
   *
   * @param {Array<{ role: string, content: string }>} messages
   * @param {Object} [opts] - { signal?, temperature?, maxTokens?, systemPrompt?, tools? }
   * @returns {AsyncGenerator<{ content?: string, reasoning?: string, toolCalls?: Array, usage?: Object }>}
   */
  async *chat(messages, opts = {}) {
    const provider = providers[activeConfig.provider];
    if (!provider) {
      throw new Error(
        'No LLM provider configured. Please set up a provider in Settings.'
      );
    }
    if (!activeConfig.apiKey) {
      throw new Error(
        `API key not set for ${provider.name}. Please add your key in Settings.`
      );
    }

    // Prepend system prompt if provided
    const fullMessages = opts.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
      : messages;

    const config = {
      apiKey: activeConfig.apiKey,
      baseUrl: activeConfig.baseUrl,
      model: activeConfig.model || provider.defaultModel,
    };

    yield* provider.stream(config, fullMessages, {
      signal: opts.signal,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      tools: opts.tools,
    });
  },

  /**
   * Convenience: collect the full response as a single string.
   * @param {Array} messages
   * @param {Object} [opts]
   * @returns {Promise<string>}
   */
  async chatComplete(messages, opts = {}) {
    let result = '';
    for await (const chunk of llm.chat(messages, opts)) {
      if (typeof chunk === 'string') {
        result += chunk;
      } else if (chunk.content) {
        result += chunk.content;
      }
    }
    return result;
  },

  /**
   * Check if the service is configured and ready.
   * @returns {boolean}
   */
  isConfigured() {
    return !!(activeConfig.provider && activeConfig.apiKey);
  },
};

export default llm;
