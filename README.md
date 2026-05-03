# VertexAgent

A lightweight AI agent that runs **entirely in your browser** — zero install, zero config, zero backend required.

Visit **https://backsapce.github.io/VertexAgent/** — pick a model and start chatting. That's it. All data stays on your device via the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Optionally connect a remote (or local) **Agent Node** to let the AI execute shell commands on your behalf.

> **Recommended usage:** just use the hosted GitHub Pages link above. VertexAgent runs purely in your browser — there is no server, no data sync, nothing to self-host. Everything is totally private on your own device.

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

The easiest way to use VertexAgent is to visit **https://backsapce.github.io/VertexAgent/** in your browser. No install, no config, no server — it's a pure client-side app that lives 100% in your browser.

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
  --name vertex-server \
  --restart unless-stopped \
  -p 3099:3099 \
  -e AGENT_ALLOWED_ORIGINS=http://your-frontend-host:3099 \
  -v $(pwd)/.vertex-agent:/app/.vertex-agent \
  backsapce/vertex-server:latest
```

When a new agent is added, a **temporary token** is printed to the console. View it with:

```bash
docker logs vertex-server
```

Paste the temp token into the VertexAgent settings panel to pair. A long-lived token is then exchanged and persisted automatically.

> The agent is entirely optional — VertexAgent works as a pure chat UI without any sandbox connected.

#### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `AGENT_PORT` | `3099` | Port the agent server listens on |
| `AGENT_TOKEN_FILE` | `/app/.agent-token` | Path to persist long-lived auth tokens |
| `AGENT_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated allowed CORS origins |

## Self-Hosting (Optional)

You don't need to self-host VertexAgent — just use the [GitHub Pages](https://backsapce.github.io/VertexAgent/) link. But if you prefer to run your own instance:

```bash
docker run -d --name vertex-agent -p 80:80 backsapce/vertex-agent:latest
```

## License

MIT
