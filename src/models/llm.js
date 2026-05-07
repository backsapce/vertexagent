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
import deepseek from './providers/deepseek.js';
import customOpenai from './providers/custom-openai.js';
import { loadSettings, saveSettings } from './settings.js';

// ─── Provider registry ──────────────────────────────────────────────────────

const providers = {
  openai,
  anthropic,
  gemini,
  openrouter,
  qwen,
  deepseek,
  'custom-openai': customOpenai,
};

// ─── Active config (in-memory) ──────────────────────────────────────────────

let activeProfileId = null;
let profiles = {};

function generateProfileId() {
  return `llm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function defaultProfileName(cfg) {
  const providerName = providers[cfg.provider]?.name || cfg.provider || 'LLM';
  return cfg.model ? `${providerName} / ${cfg.model}` : providerName;
}

function normalizeProfile(id, cfg = {}) {
  return {
    id,
    name: cfg.name || defaultProfileName(cfg),
    provider: cfg.provider || null,
    apiKey: cfg.apiKey || null,
    baseUrl: cfg.baseUrl || null,
    model: cfg.model || null,
  };
}

function normalizeSettings(saved) {
  if (!saved) {
    return { activeProfileId: null, profiles: {} };
  }

  if (saved.profiles && typeof saved.profiles === 'object') {
    const normalized = {};
    for (const [id, profile] of Object.entries(saved.profiles)) {
      normalized[id] = normalizeProfile(id, profile);
    }
    const firstId = Object.keys(normalized)[0] || null;
    return {
      activeProfileId: saved.activeProfileId && normalized[saved.activeProfileId]
        ? saved.activeProfileId
        : firstId,
      profiles: normalized,
    };
  }

  // Legacy single-LLM config migration.
  if (saved.provider || saved.apiKey || saved.model || saved.baseUrl) {
    const id = saved.id || 'default';
    return {
      activeProfileId: id,
      profiles: {
        [id]: normalizeProfile(id, saved),
      },
    };
  }

  return { activeProfileId: null, profiles: {} };
}

function getProfile(profileId = activeProfileId) {
  return profileId ? profiles[profileId] : null;
}

async function persistSettings() {
  await saveSettings({
    activeProfileId,
    profiles,
  });
}

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
  getActiveConfig(profileId = activeProfileId) {
    const profile = getProfile(profileId);
    const p = providers[profile?.provider];
    return {
      id: profile?.id || null,
      name: profile?.name || null,
      provider: profile?.provider || null,
      model: profile?.model || p?.defaultModel || null,
      baseUrl: profile?.baseUrl || null,
      configured: !!(profile?.provider && profile?.apiKey),
      hasApiKey: !!profile?.apiKey,
    };
  },

  getProfiles() {
    return Object.values(profiles).map((profile) => llm.getActiveConfig(profile.id));
  },

  getActiveProfileId() {
    return activeProfileId;
  },

  /**
   * Fetch model list from a provider's API.
   * Falls back to hardcoded fallbackModels on error.
   * @param {string} providerId
   * @param {Object} config - { apiKey, baseUrl? }
   * @returns {Promise<Array<{ id, name }>>}
   */
  async fetchModels(providerId, config = {}, profileId = activeProfileId) {
    const provider = providers[providerId];
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);
    // Use saved API key as fallback when none is explicitly provided
    const profile = getProfile(profileId);
    const apiKey = config.apiKey || profile?.apiKey;
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

    const id = Object.prototype.hasOwnProperty.call(cfg, 'id')
      ? (cfg.id || generateProfileId())
      : (activeProfileId || generateProfileId());
    const previous = profiles[id] || { id };
    const next = normalizeProfile(id, { ...previous, ...cfg, apiKey: cfg.apiKey || previous.apiKey });
    profiles = { ...profiles, [id]: next };
    activeProfileId = id;
    await persistSettings();
    return llm.getActiveConfig(id);
  },

  async selectProfile(profileId) {
    if (profileId && !profiles[profileId]) {
      throw new Error(`Unknown LLM profile: ${profileId}`);
    }
    activeProfileId = profileId || null;
    await persistSettings();
    return llm.getActiveConfig();
  },

  async deleteProfile(profileId) {
    if (!profiles[profileId]) return llm.getActiveConfig();
    const nextProfiles = { ...profiles };
    delete nextProfiles[profileId];
    profiles = nextProfiles;
    if (activeProfileId === profileId) {
      activeProfileId = Object.keys(profiles)[0] || null;
    }
    await persistSettings();
    return llm.getActiveConfig();
  },

  /**
   * Load persisted settings from OPFS (call once at app startup).
   */
  async init() {
    const saved = await loadSettings();
    const normalized = normalizeSettings(saved);
    activeProfileId = normalized.activeProfileId;
    profiles = normalized.profiles;
    if (saved && !saved.profiles && activeProfileId) {
      await persistSettings();
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
    const profile = getProfile(opts.llmProfileId);
    const provider = providers[profile?.provider];
    if (!provider) {
      throw new Error(
        'No LLM provider configured. Please set up a provider in Settings.'
      );
    }
    if (!profile.apiKey) {
      throw new Error(
        `API key not set for ${provider.name}. Please add your key in Settings.`
      );
    }

    // Prepend system prompt if provided
    const fullMessages = opts.systemPrompt
      ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
      : messages;

    const config = {
      apiKey: profile.apiKey,
      baseUrl: profile.baseUrl,
      model: profile.model || provider.defaultModel,
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
    const profile = getProfile();
    return !!(profile?.provider && profile?.apiKey);
  },

  isProfileConfigured(profileId = activeProfileId) {
    const profile = getProfile(profileId);
    return !!(profile?.provider && profile?.apiKey);
  },
};

export default llm;
