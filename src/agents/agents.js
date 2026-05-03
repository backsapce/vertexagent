/**
 * Agent Management — multi-agent workspace system.
 *
 * Each agent has its own isolated workspace in OPFS:
 *   vertex-agent/workspace/agent-xxxxxx/
 *     meta.json     — { id, name, createdAt }
 *     AGENTS.md     — agent identity: whoami, capabilities, workspace context
 *     memory/       — MEMORY.md, USER.md
 *     skills/       — agent-specific skills
 *     files/        — agent-scoped files for tool execution
 *
 * Global skills (vertex-agent/skills/) are shared across all agents.
 * Chats and messages remain global.
 *
 * Usage:
 *   import { ensureDefaultAgent, listAgents, createAgent, getWorkspaceDir } from './agents/agents';
 */

import config from '../config/config';
import { writeAgentAgentsFile, readAgentAgentsFile } from '../vfs/opfs.js';

const ROOT_DIR = 'vertex-agent';
const WORKSPACE_DIR = 'workspace';

// ─── OPFS helpers ─────────────────────────────────────────────────────────────

async function getRootDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

async function getDirectory(...pathParts) {
  let dir = await getRootDir();
  for (const part of pathParts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

async function readJSON(dirHandle, filename) {
  try {
    const fh = await dirHandle.getFileHandle(filename);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function writeJSON(dirHandle, filename, data) {
  const fh = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/**
 * Recursively copy all entries from one directory to another.
 */
async function copyDirContents(srcDir, destDir) {
  for await (const [entryName, handle] of srcDir) {
    if (handle.kind === 'directory') {
      const subDest = await destDir.getDirectoryHandle(entryName, { create: true });
      await copyDirContents(handle, subDest);
    } else if (handle.kind === 'file') {
      const file = await handle.getFile();
      const content = await file.text();
      const newFile = await destDir.getFileHandle(entryName, { create: true });
      const writable = await newFile.createWritable();
      await writable.write(content);
      await writable.close();
    }
  }
}

/**
 * Get the workspace directory name for a given agent ID.
 * Looks up the agent's current display name from config.
 * @param {string} agentId
 * @returns {Promise<string>}
 */
export async function getWorkspaceDirName(agentId) {
  const agents = await listAgents();
  const agent = agents.find((a) => a.id === agentId);
  return agent ? agent.name : agentId;
}

// ─── ID generation ────────────────────────────────────────────────────────────

/** Generate a random 6-char alphanumeric ID. */
export function generateAgentId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `agent-${out}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Ensure at least one default agent exists. Creates one on first startup.
 * @returns {Promise<string>} The default agent ID
 */
export async function ensureDefaultAgent() {
  while (!config.initialized) await new Promise((r) => setTimeout(r, 50));

  const agents = config.get('agentsList') || [];
  if (agents.length > 0) {
    // Agent already exists — ensure its workspace and AGENTS.md exist too (for upgrades)
    await ensureAgentWorkspace(agents[0].id, agents[0].name);
    return agents[0].id;
  }

  const id = generateAgentId();
  const agent = { id, name: id, createdAt: new Date().toISOString() };
  await config.set('agentsList', [agent]);

  await ensureAgentWorkspace(id, id);
  const wsDir = await getWorkspaceDir(id);
  await writeJSON(wsDir, 'meta.json', agent);

  return id;
}

/**
 * List all agents.
 * @returns {Promise<Array<{ id: string, name: string, createdAt: string }>>}
 */
export async function listAgents() {
  while (!config.initialized) await new Promise((r) => setTimeout(r, 50));
  return config.get('agentsList') || [];
}

/**
 * Get a single agent by ID.
 * @param {string} id
 * @returns {Promise<{ id: string, name: string, createdAt: string }|null>}
 */
export async function getAgent(id) {
  const agents = await listAgents();
  return agents.find((a) => a.id === id) || null;
}

/**
 * Create a new agent with workspace.
 * @param {string} [name] — optional display name (defaults to agent-xxxxxx)
 * @returns {Promise<{ id: string, name: string, createdAt: string }>}
 */
export async function createAgent(name) {
  const id = generateAgentId();
  const agentName = name || id;
  const agent = { id, name: agentName, createdAt: new Date().toISOString() };

  const agents = await listAgents();
  agents.push(agent);
  await config.set('agentsList', agents);

  await ensureAgentWorkspace(id, agentName);
  const wsDir = await getWorkspaceDir(id);
  await writeJSON(wsDir, 'meta.json', agent);

  return agent;
}

/**
 * Delete an agent and its workspace.
 * @param {string} id
 */
export async function deleteAgent(id) {
  const agents = await listAgents();
  const agent = agents.find((a) => a.id === id);
  const workspaceName = agent ? agent.name : id;
  const remaining = agents.filter((a) => a.id !== id);
  await config.set('agentsList', remaining);

  // Remove workspace directory
  try {
    const root = await getRootDir();
    const wsDir = await root.getDirectoryHandle(WORKSPACE_DIR);
    await wsDir.removeEntry(workspaceName, { recursive: true });
  } catch {
    // workspace may not exist
  }
}

/**
 * Update an agent's display name. Also renames the workspace directory.
 * @param {string} id
 * @param {string} name
 */
export async function updateAgentName(id, name) {
  const agents = await listAgents();
  const agent = agents.find((a) => a.id === id);
  const oldName = agent ? agent.name : id;
  const updated = agents.map((a) => (a.id === id ? { ...a, name } : a));
  await config.set('agentsList', updated);

  // Rename workspace directory from old name to new name
  try {
    const root = await getRootDir();
    const wsParent = await root.getDirectoryHandle(WORKSPACE_DIR);
    const oldDir = await wsParent.getDirectoryHandle(oldName);

    // Create new directory
    const newDir = await wsParent.getDirectoryHandle(name, { create: true });

    // Copy all entries from old dir to new dir
    for await (const [entryName, handle] of oldDir) {
      if (handle.kind === 'directory') {
        const newSubDir = await newDir.getDirectoryHandle(entryName, { create: true });
        await copyDirContents(handle, newSubDir);
      } else if (handle.kind === 'file') {
        const file = await handle.getFile();
        const content = await file.text();
        const newFile = await newDir.getFileHandle(entryName, { create: true });
        const writable = await newFile.createWritable();
        await writable.write(content);
        await writable.close();
      }
    }

    // Remove old directory
    await wsParent.removeEntry(oldName, { recursive: true });

    // Update meta.json with new name
    const existing = await readJSON(newDir, 'meta.json');
    if (existing) {
      await writeJSON(newDir, 'meta.json', { ...existing, name });
    }

    // Update AGENTS.md with new name
    const agentsContent = await readAgentAgentsFile(id);
    if (agentsContent) {
      const updated = agentsContent
        .replace(/^name:.*$/m, `name: ${name}`)
        .replace(/^# Agent:.*$/m, `# Agent: ${name}`)
        .replace(/\*\*Name:\*\*.*$/m, `**Name:** ${name}`);
      await writeAgentAgentsFile(id, updated);
    }
  } catch {
    // workspace may not exist, still update config name
  }
}

/**
 * Get the OPFS directory handle for an agent's workspace root.
 * Uses the agent's current display name as the directory name.
 * @param {string} agentId
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
export async function getWorkspaceDir(agentId) {
  const dirName = await getWorkspaceDirName(agentId);
  return getDirectory(WORKSPACE_DIR, dirName);
}

/**
 * Generate default AGENTS.md content for an agent.
 * @param {string} agentId
 * @param {string} name
 * @returns {string}
 */
function defaultAgentsMd(agentId, name) {
  return `---
name: ${name}
id: ${agentId}
created: ${new Date().toISOString()}
---

# Agent: ${name}

You are an AI agent in the VertexAgent system.

## Identity

- **Name:** ${name}
- **ID:** ${agentId}

## Capabilities

You can execute commands, read/write files, manage directories, maintain memory notes, and use skills. Work autonomously to assist the user with their tasks.

## Workspace

Your files are scoped to your workspace. Use the file tools to read, create, and modify files within your workspace directory.

## Memory

Maintain notes about the user and your work in memory files. Use memory tools to persist important context across sessions.
`;
}

/**
 * Ensure an agent's workspace directories exist.
 * Uses the agent's current display name as the directory name.
 * @param {string} agentId
 * @param {string} [name] — optional display name for AGENTS.md
 */
export async function ensureAgentWorkspace(agentId, name) {
  const dirName = await getWorkspaceDirName(agentId);
  await getDirectory(WORKSPACE_DIR, dirName, 'memory');
  await getDirectory(WORKSPACE_DIR, dirName, 'skills');
  await getDirectory(WORKSPACE_DIR, dirName, 'files');

  // Create default AGENTS.md if it doesn't exist yet
  const existing = await readAgentAgentsFile(agentId);
  if (!existing) {
    await writeAgentAgentsFile(agentId, defaultAgentsMd(agentId, name || dirName));
  }
}
