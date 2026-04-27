/**
 * OPFS-based Virtual File System for Vertex Agent
 * Uses the Origin Private File System to persist data in the browser.
 */

import JSZip from 'jszip';

const ROOT_DIR = 'vertex-agent';

// ─── Core Helpers ─────────────────────────────────────────────────────────────

/**
 * Get the root directory handle for the application.
 */
async function getRootDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(ROOT_DIR, { create: true });
}

/**
 * Get a directory handle by path (creates if not exists).
 * @param {string[]} pathParts - Array of directory names
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getDirectory(...pathParts) {
  let dir = await getRootDir();
  for (const part of pathParts) {
    dir = await dir.getDirectoryHandle(part, { create: true });
  }
  return dir;
}

/**
 * Read a JSON file from a directory.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 * @returns {Promise<any>}
 */
async function readJSON(dirHandle, filename) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

/**
 * Write data as JSON to a file.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 * @param {any} data
 */
async function writeJSON(dirHandle, filename, data) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
}

/**
 * Read a file as text.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 * @returns {Promise<string|null>}
 */
async function readText(dirHandle, filename) {
  try {
    const fileHandle = await dirHandle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

/**
 * Write text to a file.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 * @param {string|Blob} content
 */
async function writeText(dirHandle, filename, content) {
  const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

/**
 * Delete a file from a directory.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} filename
 */
async function deleteEntry(dirHandle, filename) {
  try {
    await dirHandle.removeEntry(filename);
  } catch (_e) { /* ignore */ }
}

/**
 * List all entries in a directory.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<Array<{name: string, kind: 'file'|'directory'}>>}
 */
async function listEntries(dirHandle) {
  const entries = [];
  for await (const [name, handle] of dirHandle) {
    entries.push({ name, kind: handle.kind });
  }
  return entries;
}

// ─── Chat Operations ──────────────────────────────────────────────────────────

const CHATS_FILE = 'chats.json';
const MESSAGES_DIR = 'messages';

/**
 * Load all chats with their messages.
 * @returns {Promise<Array>}
 */
export async function loadChats() {
  const root = await getRootDir();
  const chats = await readJSON(root, CHATS_FILE) || [];
  const msgsDir = await getDirectory(MESSAGES_DIR);

  return Promise.all(
    chats.map(async (chat) => ({
      ...chat,
      messages: (await readJSON(msgsDir, `${chat.id}.json`)) || [],
    }))
  );
}

/**
 * Save all chats.
 * @param {Array} chats - Array of chat objects with messages
 */
export async function saveChats(chats) {
  const root = await getRootDir();
  const msgsDir = await getDirectory(MESSAGES_DIR);

  // Save metadata
  await writeJSON(
    root,
    CHATS_FILE,
    chats.map(({ messages: _messages, ...rest }) => rest)
  );

  // Save messages in parallel
  await Promise.all(
    chats.map((chat) => writeJSON(msgsDir, `${chat.id}.json`, chat.messages))
  );
}

/**
 * Delete a chat.
 * @param {Array} chats - All chats
 * @param {string} chatId - ID of chat to delete
 * @returns {Array} Remaining chats
 */
export async function deleteChat(chats, chatId) {
  const root = await getRootDir();
  const msgsDir = await getDirectory(MESSAGES_DIR);
  const remaining = chats.filter((c) => c.id !== chatId);

  await writeJSON(
    root,
    CHATS_FILE,
    remaining.map(({ messages: _messages, ...rest }) => rest)
  );
  await deleteEntry(msgsDir, `${chatId}.json`);

  return remaining;
}

/**
 * Clear all data.
 */
export async function clearAll() {
  const root = await navigator.storage.getDirectory();
  try {
    await root.removeEntry(ROOT_DIR, { recursive: true });
  } catch (_e) { /* ignore */ }
}

// ─── Export/Import ────────────────────────────────────────────────────────────

/**
 * Export all data to a zip file.
 * @returns {Promise<Blob>}
 */
export async function exportToZip() {
  const root = await getRootDir();
  const zip = new JSZip();

  async function collect(dir, prefix = '') {
    for (const { name, kind } of await listEntries(dir)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (kind === 'file') {
        zip.file(path, await readText(dir, name));
      } else {
        await collect(await dir.getDirectoryHandle(name), path);
      }
    }
  }

  await collect(root);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/**
 * Import data from a zip file.
 * @param {Blob} blob
 */
export async function importFromZip(blob) {
  const zip = await JSZip.loadAsync(blob);

  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;

    const parts = path.split('/');
    const fileName = parts.pop();
    const dir = await getDirectory(...parts);
    await writeText(dir, fileName, await file.async('string'));
  }
}

// ─── File Manager Operations ──────────────────────────────────────────────────

/**
 * Load files from a directory (depth 1).
 * @param {string} [dirName] - Directory name relative to root (undefined for root)
 * @returns {Promise<{id: string, name: string, type: string, children: Array}|Array>}
 */
export async function loadFiles(dirName) {
  const dir = dirName ? await getDirectory(...dirName.split('/')) : await getRootDir();
  const children = [];

  for (const { name, kind } of await listEntries(dir)) {
    if (kind === 'file') {
      const file = await (await dir.getFileHandle(name)).getFile();
      children.push({
        id: `file-${dirName || 'root'}-${name}`,
        name,
        type: 'file',
        size: file.size,
        lastModified: file.lastModified,
        fileName: name,
        category: dirName || 'root',
        parentDir: dirName,
      });
    } else {
      const subdir = await dir.getDirectoryHandle(name);
      const subChildren = [];
      for (const { name: subName, kind: subKind } of await listEntries(subdir)) {
        if (subKind === 'file') {
          const subFile = await (await subdir.getFileHandle(subName)).getFile();
          subChildren.push({
            id: `file-${dirName ? `${dirName}/${name}` : name}-${subName}`,
            name: subName,
            type: 'file',
            size: subFile.size,
            lastModified: subFile.lastModified,
            fileName: subName,
            category: dirName ? `${dirName}/${name}` : name,
            parentDir: dirName ? `${dirName}/${name}` : name,
          });
        } else {
          subChildren.push({
            id: `dir-${dirName ? `${dirName}/${name}` : name}-${subName}`,
            name: subName,
            type: 'directory',
            children: [],
            parentDir: dirName ? `${dirName}/${name}` : name,
          });
        }
      }
      children.push({
        id: `dir-${dirName || 'root'}-${name}`,
        name,
        type: 'directory',
        children: subChildren,
        parentDir: dirName,
      });
    }
  }

  // Return tree structure for root, array for subdirectories
  return dirName
    ? children
    : { id: 'root', name: '/', type: 'directory', children };
}

/**
 * Load contents of a directory (alias for loadFiles with dirName).
 * @param {string} dirName - Directory name relative to root
 * @returns {Promise<Array>}
 */

/**
 * Save a file to a directory.
 * @param {string} fileName - Name of the file
 * @param {Blob} blob - The file blob
 * @param {string} [dirName] - Directory name relative to root (undefined for 'files' default)
 */
export async function saveFile(fileName, blob, dirName) {
  const dir = dirName === null
    ? await getRootDir()
    : dirName
    ? await getDirectory(dirName)
    : await getDirectory('files');
  await writeText(dir, fileName, blob);
}

/**
 * Delete a file or directory.
 * @param {string} fileName
 * @param {string} category - 'root', 'messages', 'uploads', or directory path (e.g. 'folder/subfolder')
 * @param {boolean} isDirectory - whether to delete recursively
 */
export async function deleteFile(fileName, category, isDirectory = false) {
  const dir =
    category === 'root' || category === null
      ? await getRootDir()
      : category === 'messages'
      ? await getDirectory('messages')
      : category === 'files'
      ? await getDirectory('files')
      : category
      ? await getDirectory(...category.split('/').filter(Boolean))
      : await getDirectory('files');

  await dir.removeEntry(fileName, { recursive: isDirectory });
}

/**
 * Get a file as Blob.
 * @param {string} fileName
 * @param {string} category - 'root', 'messages', 'uploads', or directory name
 * @returns {Promise<Blob>}
 */
export async function getFileBlob(fileName, category) {
  const dir =
    category === 'root' || category === null
      ? await getRootDir()
      : category === 'messages'
      ? await getDirectory('messages')
      : category === 'files'
      ? await getDirectory('files')
      : category
      ? await getDirectory(category)
      : await getDirectory('files');

  const fileHandle = await dir.getFileHandle(fileName);
  return fileHandle.getFile();
}

/**
 * Create a new file in a directory.
 * @param {string} fileName - Name of the file to create
 * @param {string} [dirName] - Directory name relative to root (undefined for root)
 * @returns {Promise<void>}
 */
export async function createFile(fileName, dirName) {
  const dir = dirName ? await getDirectory(...dirName.split('/')) : await getRootDir();
  await writeText(dir, fileName, '');
}

/**
 * Create a new directory.
 * @param {string} dirName - Name of the directory to create
 * @param {string} [parentDirName] - Parent directory name relative to root (undefined for root)
 * @returns {Promise<void>}
 */
export async function createDirectory(dirName, parentDirName) {
  const parentDir = parentDirName ? await getDirectory(...parentDirName.split('/')) : await getRootDir();
  await parentDir.getDirectoryHandle(dirName, { create: true });
}

/**
 * Read text content from a file.
 * @param {string} fileName - Name of the file to read
 * @param {string} [dirName] - Directory name relative to root (undefined for root)
 * @returns {Promise<string>}
 */
export async function readFileContent(fileName, dirName) {
  const dir = dirName ? await getDirectory(...dirName.split('/')) : await getRootDir();
  const fileHandle = await dir.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return await file.text();
}

/**
 * Save text content to a file.
 * @param {string} fileName - Name of the file to save
 * @param {string} content - Text content to save
 * @param {string} [dirName] - Directory name relative to root (undefined for root)
 * @returns {Promise<void>}
 */
export async function saveFileContent(fileName, content, dirName) {
  const dir = dirName ? await getDirectory(...dirName.split('/')) : await getRootDir();
  await writeText(dir, fileName, content);
}

// ─── Memory Operations ────────────────────────────────────────────────────────

const MEMORY_DIR = 'memory';
const MEMORY_FILE = 'MEMORY.md';
const USER_FILE = 'USER.md';

/**
 * Read a memory file from OPFS.
 * @param {string} filename - MEMORY.md or USER.md
 * @returns {Promise<string>}
 */
export async function readMemoryFile(filename) {
  try {
    const dir = await getDirectory(MEMORY_DIR);
    return await readText(dir, filename);
  } catch {
    return null;
  }
}

/**
 * Write a memory file to OPFS (overwrite).
 * @param {string} filename - MEMORY.md or USER.md
 * @param {string} content
 */
export async function writeMemoryFile(filename, content) {
  const dir = await getDirectory(MEMORY_DIR);
  await writeText(dir, filename, content);
}

/**
 * Delete a memory file.
 * @param {string} filename - MEMORY.md or USER.md
 */
export async function deleteMemoryFile(filename) {
  try {
    const dir = await getDirectory(MEMORY_DIR);
    await deleteEntry(dir, filename);
  } catch { /* ignore */ }
}

// ─── Skill Operations ─────────────────────────────────────────────────────────

const SKILLS_DIR = 'skills';

/**
 * List all skill directories.
 * @returns {Promise<Array<{ name: string, hasReferences: boolean }>>}
 */
export async function listSkillDirs() {
  try {
    const dir = await getDirectory(SKILLS_DIR);
    const skills = [];
    for (const { name, kind } of await listEntries(dir)) {
      if (kind === 'directory') {
        const skillDir = await dir.getDirectoryHandle(name);
        let hasReferences = false;
        for (const entry of await listEntries(skillDir)) {
          if (entry.name === 'references' && entry.kind === 'directory') {
            hasReferences = true;
            break;
          }
        }
        skills.push({ name, hasReferences });
      }
    }
    return skills;
  } catch {
    return [];
  }
}

/**
 * Read a file from a skill directory.
 * @param {string} skillName - Skill directory name
 * @param {string} filename - File to read (e.g., SKILL.md)
 * @returns {Promise<string|null>}
 */
export async function readSkillFile(skillName, filename) {
  try {
    const dir = await getDirectory(SKILLS_DIR, skillName);
    return await readText(dir, filename);
  } catch {
    return null;
  }
}

/**
 * Write a file to a skill directory.
 * @param {string} skillName - Skill directory name
 * @param {string} filename - File to write (e.g., SKILL.md)
 * @param {string} content
 */
export async function writeSkillFile(skillName, filename, content) {
  const dir = await getDirectory(SKILLS_DIR, skillName);
  await writeText(dir, filename, content);
}

/**
 * Delete a skill directory.
 * @param {string} skillName
 */
export async function deleteSkillDir(skillName) {
  try {
    const dir = await getDirectory(SKILLS_DIR);
    await dir.removeEntry(skillName, { recursive: true });
  } catch { /* ignore */ }
}

/**
 * List files in a skill's references directory.
 * @param {string} skillName
 * @returns {Promise<Array<{ name: string }>>}
 */
export async function listSkillRefs(skillName) {
  try {
    const dir = await getDirectory(SKILLS_DIR, skillName, 'references');
    const refs = [];
    for (const { name, kind } of await listEntries(dir)) {
      if (kind === 'file') refs.push({ name });
    }
    return refs;
  } catch {
    return [];
  }
}

/**
 * Read a reference file from a skill.
 * @param {string} skillName
 * @param {string} filename
 * @returns {Promise<string|null>}
 */
export async function readSkillRef(skillName, filename) {
  try {
    const dir = await getDirectory(SKILLS_DIR, skillName, 'references');
    return await readText(dir, filename);
  } catch {
    return null;
  }
}
