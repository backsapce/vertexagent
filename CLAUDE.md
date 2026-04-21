# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

VertexAgent is a browser-based AI agent framework. It's a React SPA that connects to LLM providers (OpenAI, Anthropic, Gemini, OpenRouter, Qwen, custom OpenAI-compatible) for chat, and optionally to a Node.js agent server for shell command execution. All browser data is persisted in OPFS (Origin Private File System).

## Commands

- **Dev (both frontend + agent server):** `npm run dev` — runs Vite (port 5173) and agent server (port 3099) concurrently
- **Dev frontend only:** `npm run dev:front`
- **Dev agent server only:** `npm run dev:agent`
- **Build:** `npm run build` — Vite production build + service worker precache injection
- **Build for GitHub Pages:** `npm run build:pages` — sets `VITE_BASE=/VertexAgent/` base path
- **Lint:** `npm run lint`
- **Preview production build:** `npm run preview` — serves dist/ on port 5173 (same port as dev to preserve OPFS data)
- **Docker build:** `npm run build:docker` — multi-platform build + push

## Architecture

### Two-part system

1. **Browser app** (React SPA in `src/`) — chat UI, LLM streaming, OPFS persistence, PWA
2. **Agent server** (`server/agent.js`) — Node.js HTTP server at `/agent` for shell command execution and remote file management, proxied by Vite in dev

The agent server is optional — the app works without it (just no command execution). It uses a temp-token -> long-lived-token authentication flow. All `/agent` requests are proxied through Vite so the browser talks to the same origin.

### Key modules

- **`src/config/config.js`** — YAML-based config persisted in OPFS. Dot-path access (`config.get('llm.provider')`), subscribe/notify pattern, singleton. All modules read config through this.
- **`src/models/llm.js`** — Unified LLM interface. Provider registry pattern — each provider in `src/models/providers/` implements `{ id, name, stream, listModels, fallbackModels }`. The `chat()` method returns an async generator of `{ content, reasoning }` chunks. Tool calls use `<execute>` XML tags parsed from LLM output, not native API tool calling.
- **`src/models/agent.js`** — Client for the agent server. Token management, health checks, command execution, remote file CRUD. Tokens are persisted per-agent-url in config.
- **`src/vfs/opfs.js`** — OPFS abstraction. Chats stored as `chats.json` (metadata) + `messages/<id>.json` (per-chat messages). Also handles file manager operations, export/import as zip.
- **`src/App.jsx`** — Main component. Manages chats, streaming, theme, locale, agent connections. Streaming uses refs (`streamingContentRef`, `streamingThinkingRef`) outside React state, flushed to UI via `requestAnimationFrame`. Tool execution loops up to `MAX_TOOL_ROUNDS=10` rounds of LLM -> execute -> feed results back.

### Data flow for tool execution

User message -> LLM stream -> parse `<execute>` blocks from response -> POST to agent server -> feed stdout/stderr back as `[Tool execution results]` user message -> LLM continues. This repeats up to 10 rounds.

### i18n

`src/i18n/` — React context-based. `t()` function uses dot-path keys with `{param}` interpolation. Locale files in `src/i18n/locales/` (en, zh-CN, ja). Supports `auto` (browser language detection).

### PWA

Service worker in `public/sw.js` with precache manifest injected at build time by the `swPrecachePlugin` in `vite.config.js`.

## Important conventions

- ESLint rule: `no-unused-vars` ignores variables matching `^[A-Z_]` (use uppercase prefix for intentionally unused variables like `_llmReady`)
- Provider modules must export `{ id, name, stream, listModels, fallbackModels, defaultModel }`
- All browser persistence goes through OPFS, not localStorage or IndexedDB directly
- The Vite dev server port (5173) must match the preview port so OPFS data survives across dev/preview mode switches
- Streaming avoids per-chunk `setState` — content accumulates in refs and is flushed to React state via `requestAnimationFrame` for frame-synced rendering
