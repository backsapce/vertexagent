# VertexAgent

A lightweight AI agent that runs **entirely in your browser** — zero install, zero config, zero backend required.

Open the page, pick a model, and start chatting. All data stays on your device via the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Optionally connect a remote (or local) **Agent Node** to let the AI execute shell commands on your behalf.

## Highlights

- **Pure browser runtime** — no server, no database, no signup. Works offline as a PWA.
- **Zero install & config** — open the URL and go. Settings are persisted in-browser automatically.
- **Multi-provider LLM support** — OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Qwen, or any OpenAI-compatible endpoint.API KEY SAVE IN YOUR LOCAL BROSWER,NOT ON SERVER.
- **Flexible sandbox types** — run commands via **E2B Cloud Sandbox** or **any custom remote/self-hosted Agent Node** (local or remote), all with token-based authentication.
- **OPFS-powered storage** — chat history, settings, and config all live in the browser's private filesystem.
- **Data portability** — export everything to a ZIP, import it back, or factory-reset with one click.
- **Installable PWA** — add to home screen for a native app experience.
- **File manager** - for local broswer or remote sandbox

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

```bash
# on your server (port 3099)
node server/agent.js
```

On first launch a **temporary token** is printed to the console. Paste it into the VertexAgent settings panel to pair. A long-lived token is then exchanged and persisted automatically.

### Local Agent Node

Run `agent.js` on your own machine alongside the dev server for local shell access. The local agent is auto-detected on startup.

```bash
# start both frontend + local agent (port 5173 + 3099)
npm run dev
```

> The agent is entirely optional — VertexAgent works as a pure chat UI without any sandbox connected.

## Docker

```bash
docker build -t vertex-agent .
docker run -p 80:80 vertex-agent
```

## License

MIT
