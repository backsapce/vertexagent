/**
 * Memory System — two bounded, file-backed stores in OPFS.
 *
 * Inspired by Hermes Agent's MEMORY.md / USER.md pattern.
 * - MEMORY.md: agent notes about environment, project conventions, tool quirks
 * - USER.md: user profile, preferences, communication style
 *
 * Entries are delimited by `§` and have character limits to prevent unbounded growth.
 * Memory is loaded once per chat session (frozen snapshot), not per turn.
 * Mid-session writes update disk but do NOT change the active system prompt.
 *
 * Usage:
 *   import { loadMemory, saveMemory, saveUser } from './agent/memory';
 *   const { memory, user } = await loadMemory();
 *   await saveMemory('User prefers verbose explanations\n');
 */

import { readMemoryFile, writeMemoryFile, deleteMemoryFile, readAgentMemoryFile, writeAgentMemoryFile, deleteAgentMemoryFile } from '../vfs/opfs';

export const MEMORY_MAX = 2200;
export const USER_MAX = 1375;
const DELIMITER = '§';

/**
 * Load both memory files. Returns a frozen snapshot for session injection.
 * @param {string} [agentId] — if provided, reads from agent workspace; otherwise global
 * @returns {Promise<{ memory: string|null, user: string|null }>}
 */
export async function loadMemory(agentId) {
  if (agentId) {
    const [memory, user] = await Promise.all([
      readAgentMemoryFile(agentId, 'MEMORY.md'),
      readAgentMemoryFile(agentId, 'USER.md'),
    ]);
    return { memory, user };
  }
  const [memory, user] = await Promise.all([
    readMemoryFile('MEMORY.md'),
    readMemoryFile('USER.md'),
  ]);
  return { memory, user };
}

/**
 * Append an entry to MEMORY.md. Enforces character limit.
 * When over limit, oldest entries are dropped from the front.
 * @param {string} content
 * @param {string} [agentId] — if provided, writes to agent workspace; otherwise global
 */
export async function saveMemory(content, agentId) {
  if (agentId) {
    const existing = await readAgentMemoryFile(agentId, 'MEMORY.md');
    const updated = appendEntry(existing, content, MEMORY_MAX);
    await writeAgentMemoryFile(agentId, 'MEMORY.md', updated);
  } else {
    const existing = await readMemoryFile('MEMORY.md');
    const updated = appendEntry(existing, content, MEMORY_MAX);
    await writeMemoryFile('MEMORY.md', updated);
  }
}

/**
 * Append an entry to USER.md. Enforces character limit.
 * @param {string} content
 * @param {string} [agentId] — if provided, writes to agent workspace; otherwise global
 */
export async function saveUser(content, agentId) {
  if (agentId) {
    const existing = await readAgentMemoryFile(agentId, 'USER.md');
    const updated = appendEntry(existing, content, USER_MAX);
    await writeAgentMemoryFile(agentId, 'USER.md', updated);
  } else {
    const existing = await readMemoryFile('USER.md');
    const updated = appendEntry(existing, content, USER_MAX);
    await writeMemoryFile('USER.md', updated);
  }
}

/**
 * Clear one or both memory files.
 * @param {string} type - 'memory', 'user', or 'both'
 * @param {string} [agentId] — if provided, clears agent workspace; otherwise global
 */
export async function clearMemory(type = 'both', agentId) {
  const delFn = agentId ? deleteAgentMemoryFile : deleteMemoryFile;
  if (type === 'memory' || type === 'both') {
    await delFn(agentId, 'MEMORY.md');
  }
  if (type === 'user' || type === 'both') {
    await delFn(agentId, 'USER.md');
  }
}

/**
 * Build the memory section for the system prompt.
 * @param {{ memory: string|null, user: string|null }} snapshot
 * @returns {string}
 */
export function buildMemorySection(snapshot) {
  let out = '';
  if (snapshot.memory) {
    out += `<memory_notes>\n${snapshot.memory}\n</memory_notes>\n\n`;
  }
  if (snapshot.user) {
    out += `<user_profile>\n${snapshot.user}\n</user_profile>\n\n`;
  }
  return out;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Append a delimited entry to content, trimming oldest entries if over limit.
 */
function appendEntry(existing, newContent, maxChars) {
  const entry = newContent.trim() + `\n${DELIMITER}\n`;
  if (!existing) return entry;
  let combined = existing + entry;

  // Trim if over limit — remove oldest entries from the front
  while (combined.length > maxChars && combined.includes(DELIMITER)) {
    const firstDelim = combined.indexOf(DELIMITER);
    // Remove everything up to and including the first delimiter
    combined = combined.slice(firstDelim + DELIMITER.length + 1);
  }

  return combined.trim();
}
