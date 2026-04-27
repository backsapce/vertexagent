# VertexAgent

A lightweight AI agent that runs **entirely in your browser** — zero install, zero config, zero backend required.

Open the page, pick a model, and start chatting. All data stays on your device via the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Optionally connect a remote (or local) **Agent Node** to let the AI execute shell commands on your behalf.

## Highlights

- **Pure browser runtime** — no server, no database, no signup. Works offline as a PWA.
- **Zero install & config** — open the URL and go. Settings are persisted in-browser automatically.
- **Multi-provider LLM support** — OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Qwen, or any OpenAI-compatible endpoint. API keys are stored only in your browser, never on a server.
- **Flexible sandbox types** — run commands via **E2B Cloud Sandbox** or **any custom remote/self-hosted Agent Node** (local or remote), all with token-based authentication.
- **OPFS-powered storage** — chat history, settings, and config all live in the browser's private filesystem.
- **Data portability** — export everything to a ZIP, import it back, or factory-reset with one click.
- **Installable PWA** — add to home screen for a native app experience.
- **File manager** — browse and manage files in the browser OPFS or on the remote agent node.

## Quick Start

Just visit the hosted version — nothing to install.

To self-host or develop locally:

```bash
# clone & install
git clone https://github.com/backsapce/VertexAgent
cd VertexAgent
npm install

# dev server (hot reload)
npm run dev

# production build
npm run build
```

## Sandbox Types

VertexAgent supports multiple sandbox backends for shell command execution. Pick the one that fits your workflow:

### E2B Cloud Sandbox

Connect to [E2B](https://e2b.dev/) for a secure, ephemeral cloud sandbox — no server to manage, just an API key. Sandboxes are auto-created and persist across sessions.

1. Enter your E2B API key in the Settings panel.
2. The sandbox is created and connected automatically.

> Sandbox is identified by a persistent ID stored in `localStorage`, so it survives page reloads and reconnects to the same sandbox instance.

### Custom Remote Agent Node

Deploy `agent.js` on **any machine** (VPS, home server, another device) and connect to it from the browser. Full shell access to that host.

> **Docker deployment is recommended** for a clean, isolated runtime with no dependency setup.

#### Docker Deploy (Recommended)

```bash
# pull prebuilt image
docker run -d \
  --name vertex-agent \
  --restart unless-stopped \
  -p 3099:3099 \
  -e AGENT_ALLOWED_ORIGINS=http://your-frontend-host:5173 \
  -v $(pwd)/.vertex-agent:/app/.vertex-agent \
  backsapce/vertex-agent:latest
```

Or build from source:

```bash
docker build -t vertex-agent -f Dockerfile.agent .

docker run -d \
  --name vertex-agent \
  --restart unless-stopped \
  -p 3099:3099 \
  -e AGENT_ALLOWED_ORIGINS=http://your-frontend-host:5173 \
  -v $(pwd)/.vertex-agent:/app/.vertex-agent \
  vertex-agent
```

If new agent add, a **temporary token** is printed to the console. View it with:

```bash
docker logs vertex-agent
```

Paste the temp token into the VertexAgent settings panel to pair. A long-lived token is then exchanged and persisted automatically.

> Mount `/.vertex-agent` to a host volume so tokens survive container restarts.

#### Manual Deploy (without Docker)

```bash
# on your server (port 3099)
node server/agent.js
```

On first launch a **temporary token** is printed to the console. Paste it into the VertexAgent settings panel to pair.

### Local Agent Node

Run `agent.js` on your own machine alongside the dev server for local shell access. The local agent is auto-detected on startup.

```bash
# start both frontend + local agent (port 5173 + 3099)
npm run dev
```

> The agent is entirely optional — VertexAgent works as a pure chat UI without any sandbox connected.

## Docker

### Frontend

```bash
docker run -d --name vertex-agent-frontend -p 80:80 backsapce/vertex-agent:latest
```

### Agent Node

See the [Custom Remote Agent Node](#custom-remote-agent-node) section above for Docker deployment instructions.

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_PORT` | `3099` | Port the agent server listens on |
| `AGENT_TOKEN_FILE` | `/app/.agent-token` | Path to persist long-lived auth tokens |
| `AGENT_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated allowed CORS origins |

## License

MIT
