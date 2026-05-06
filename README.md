# VertexAgent

VertexAgent is a browser-based AI agent workspace. It runs as a React single-page app, stores data in the browser's Origin Private File System (OPFS), and can optionally connect to an execution sandbox for shell commands and file operations.

Hosted app: https://backsapce.github.io/VertexAgent/

## What It Does

- Chat with OpenAI, Anthropic, Gemini, OpenRouter, Qwen, or a custom OpenAI-compatible API.
- Run an autonomous tool loop with native provider tool calling.
- Persist chats, settings, memory, skills, and files locally in OPFS.
- Manage local browser files or files on a connected sandbox.
- Optionally execute commands through E2B Cloud Sandbox or a self-hosted Agent Node.
- Export/import browser data as a ZIP.
- Install as a PWA.

## Privacy Model

VertexAgent does not require an application backend for normal chat usage. API keys, chats, settings, memory, skills, and managed files are stored in your browser through OPFS.

External services are contacted only when you configure them:

- LLM provider APIs for chat/model requests.
- E2B when an E2B API key is enabled.
- A custom Agent Node when you add one.
- WebDAV sync when sync is configured.

## Quick Start

Use the hosted app:

```text
https://backsapce.github.io/VertexAgent/
```

For local development:

```bash
git clone https://github.com/backsapce/VertexAgent
cd VertexAgent
npm install
npm run dev
```

The dev command starts:

- Vite frontend on `https://localhost:5173`
- Local Agent Node on `http://localhost:3099`

## Commands

```bash
npm run dev          # Frontend + local Agent Node
npm run dev:front    # Frontend only
npm run dev:agent    # Agent Node only
npm run build        # Production build
npm run build:pages  # GitHub Pages build with /VertexAgent/ base path
npm run lint         # ESLint
npm run preview      # Preview dist/ on port 5173
```

## Configure An LLM

Open Settings in the app and choose a provider:

- OpenAI
- Anthropic Claude
- Google Gemini
- OpenRouter
- Qwen/DashScope
- Custom OpenAI-compatible endpoint

API keys are saved locally in browser storage through the app config.

## Sandboxes

Sandbox support is optional. VertexAgent works as a private browser chat app without any sandbox connected.

### E2B Cloud

1. Open Settings.
2. Add your E2B API key.
3. Enable E2B Cloud Sandbox.

VertexAgent keeps a sandbox ID in `localStorage` so it can reconnect after page reloads.

### Self-Hosted Agent Node

Run the Agent Node when you want VertexAgent to execute commands or manage files on a machine you control.

```bash
npm run dev:agent
```

Or run the Docker image:

```bash
docker run -d \
  --name vertex-server \
  --restart unless-stopped \
  -p 3099:3099 \
  -e AGENT_ALLOWED_ORIGINS=https://your-frontend-origin \
  -v $(pwd)/.vertex-agent:/app/.vertex-agent \
  backsapce/vertex-server:latest
```

The server prints a temporary pairing token on startup. Paste that token into VertexAgent Settings to exchange it for a long-lived token.

Agent Node environment variables:

| Variable | Default | Description |
| --- | --- | --- |
| `AGENT_PORT` | `3099` | HTTP port for `/agent` |
| `AGENT_TOKEN_FILE` | `.agent-token` | File used to persist long-lived auth tokens |
| `AGENT_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated CORS allowlist |

## Architecture

```text
src/components/      React UI
src/agent/           Agent loop, tools, context, memory, skills
src/models/          LLM providers, settings, sandbox client
src/vfs/opfs.js      OPFS virtual filesystem
src/config/          YAML-backed browser config
src/sync/            Optional WebDAV sync
server/agent.js      Optional local/remote Agent Node
public/sw.js         PWA service worker
```

Core runtime flow:

1. The user sends a message.
2. `runAgentLoop()` builds context from chat history, memory, and skills.
3. The selected provider streams model output and native tool calls.
4. Tool calls are dispatched through the tool registry.
5. Tool results are fed back to the model until the loop completes or reaches the round limit.
6. Chat state is saved back to OPFS.

## Data Storage

Browser data lives under the OPFS root:

```text
vertex-agent/
  chats.json
  messages/
  memory/
  skills/
  files/
  workspace/
```

Agent Node files live under `.vertex-agent/` in the server process working directory.

## Development Notes

- Keep browser persistence inside OPFS unless a browser API specifically requires otherwise.
- Provider modules export `id`, `name`, `stream`, `listModels`, `fallbackModels`, and `defaultModel`.
- Tool schemas are filtered by availability before they are sent to providers.
- The preview server uses port `5173` so OPFS data survives switching between dev and preview.
- Service worker precache entries are injected during production builds.

## License

MIT
