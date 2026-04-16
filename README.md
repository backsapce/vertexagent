# VertexAgent

A lightweight AI agent that runs **entirely in your browser** — zero install, zero config, zero backend required.

Open the page, pick a model, and start chatting. All data stays on your device via the [Origin Private File System](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system). Optionally connect a remote (or local) **Agent Node** to let the AI execute shell commands on your behalf.

## Highlights

- **Pure browser runtime** — no server, no database, no signup. Works offline as a PWA.
- **Zero install & config** — open the URL and go. Settings are persisted in-browser automatically.
- **Multi-provider LLM support** — OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Qwen, or any OpenAI-compatible endpoint.
- **Streaming responses** — real-time token-by-token output with smooth rendering.
- **Agent Node connection** — connect to a remote or local Agent Node to run shell commands with token-based authentication.
- **OPFS-powered storage** — chat history, settings, and config all live in the browser's private filesystem.
- **Data portability** — export everything to a ZIP, import it back, or factory-reset with one click.
- **Installable PWA** — add to home screen for a native app experience.
- **File manager** - for local broswer or remote sandbox

## Quick Start

Just visit the hosted version — nothing to install.

To self-host or develop locally:

```bash
# clone & install
git clone https://github.com/<you>/VertexAgent.git
cd VertexAgent
npm install

# dev server (hot reload)
npm run dev

# production build
npm run build
```

## Agent Node

The Agent Node is an optional lightweight server that gives the AI the ability to execute commands on a real machine.

```bash
# start the agent node (port 3099)
node server/agent.js
```

On first launch a **temporary token** is printed to the console. Paste it into the VertexAgent settings panel to pair the browser with the agent. A long-lived token is then exchanged and persisted automatically.

> The agent is entirely optional — VertexAgent works as a pure chat UI without it.

## Docker

```bash
docker build -t vertex-agent .
docker run -p 3099:3099 vertex-agent
```

## License

MIT
