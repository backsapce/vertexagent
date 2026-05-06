/**
 * Sync Manager - orchestrates full and incremental sync to WebDAV server.
 */

import config from '../config/config.js';
import { listAllFiles, getRootDir, listEntries, readText, writeText, getDirectory } from '../vfs/opfs.js';
import * as webdav from './webdav.js';

const REMOTE_ROOT = '/vertex-agent';

/**
 * Load sync settings from config.
 */
export async function loadSyncSettings() {
  return config.get('sync') || { enabled: false, mode: 'manual' };
}

/**
 * Save sync settings.
 */
export async function saveSyncSettings(settings) {
  await config.merge('sync', settings);
}

/**
 * Test WebDAV connection.
 */
export async function testSyncConnection(url, username, password) {
  if (!url || !username || !password) {
    throw new Error('URL, username, and password are required.');
  }
  return webdav.testConnection(url, username, password);
}

/**
 * Full sync: upload all OPFS data to WebDAV server.
 * Exports to zip, then uploads each file via WebDAV.
 */
export async function fullSyncToServer(url, username, password) {
  const rootDir = await getRootDir();
  const files = [];

  // Recursively collect all files
  async function collect(dir, prefix = '') {
    for (const { name, kind } of await listEntries(dir)) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (kind === 'file') {
        const content = await readText(dir, name);
        files.push({ remotePath: `${REMOTE_ROOT}/${path}`, content: content ?? '' });
      } else {
        await collect(await dir.getDirectoryHandle(name), path);
      }
    }
  }

  await collect(rootDir);

  // Upload all files
  let uploaded = 0;
  const total = files.length;

  for (const file of files) {
    await webdav.ensureDirectory(url, username, password, webdav.normalizeUrl(file.remotePath).substring(0, file.remotePath.lastIndexOf('/')));
    await webdav.putFile(url, username, password, file.remotePath, file.content, getMimeType(file.remotePath));
    uploaded++;
  }

  return { uploaded, total };
}

/**
 * Full sync: download all files from WebDAV server into OPFS.
 */
export async function fullSyncFromServer(url, username, password) {
  const allEntries = await webdav.propfind(url, username, password, REMOTE_ROOT + '/', 2);

  let downloaded = 0;

  for (const entry of allEntries) {
    if (!entry.isCollection && entry.href !== webdav.normalizeUrl(REMOTE_ROOT) + '/') {
      // Strip the remote root prefix to get local OPFS path
      let localPath = entry.href;
      const normalizedRoot = webdav.normalizeUrl(REMOTE_ROOT);
      if (localPath.startsWith(normalizedRoot + '/')) {
        localPath = localPath.substring(normalizedRoot.length + 1);
      } else if (localPath.startsWith(normalizedRoot)) {
        localPath = localPath.substring(normalizedRoot.length);
      }

      if (!localPath) continue;

      const content = await webdav.getFileText(url, username, password, entry.href);
      const parts = localPath.split('/');
      const fileName = parts.pop();

      if (parts.length > 0) {
        await getDirectory(...parts);
      }

      const dir = parts.length > 0 ? await getDirectory(...parts) : await getRootDir();
      await writeText(dir, fileName, content);
      downloaded++;
    }
  }

  return { downloaded };
}

/**
 * Get all current OPFS files for diff comparison.
 * Returns array of { localPath, content }.
 */
export async function getLocalFileSnapshot() {
  const allFiles = await listAllFiles();
  return allFiles.map(f => ({
    localPath: f.path,
    content: f.content ?? '',
    size: f.size ?? 0,
  }));
}

/**
 * Incremental sync: compare local snapshot with cached, upload changes.
 */
export async function incrementalSync(url, username, password, cachedSnapshot, setCachedSnapshot) {
  const currentSnapshot = await getLocalFileSnapshot();
  const cachedMap = new Map();
  const currentMap = new Map();

  if (cachedSnapshot) {
    for (const file of cachedSnapshot) {
      cachedMap.set(file.localPath, file);
    }
  }

  for (const file of currentSnapshot) {
    currentMap.set(file.localPath, file);
  }

  const changes = { uploaded: 0, deleted: 0, errors: [] };

  // Upload new or changed files
  for (const [path, file] of currentMap) {
    const cached = cachedMap.get(path);
    if (!cached || cached.content !== file.content || cached.size !== file.size) {
      try {
        const remotePath = `${REMOTE_ROOT}/${path}`;
        const dirPart = remotePath.substring(0, remotePath.lastIndexOf('/'));
        await webdav.ensureDirectory(url, username, password, dirPart);
        await webdav.putFile(url, username, password, remotePath, file.content, getMimeType(remotePath));
        changes.uploaded++;
      } catch (err) {
        changes.errors.push({ path, error: err.message });
      }
    }
  }

  // Delete removed files
  for (const [path, _cached] of cachedMap) {
    if (!currentMap.has(path)) {
      try {
        const remotePath = `${REMOTE_ROOT}/${path}`;
        await webdav.deleteEntry(url, username, password, remotePath);
        changes.deleted++;
      } catch (err) {
        changes.errors.push({ path, error: err.message });
      }
    }
  }

  // Update snapshot
  setCachedSnapshot(currentSnapshot);

  return changes;
}

/**
 * Infer MIME type from file path.
 */
function getMimeType(filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  const mimeMap = {
    'json': 'application/json',
    'yaml': 'text/yaml',
    'yml': 'text/yaml',
    'md': 'text/markdown',
    'txt': 'text/plain',
    'html': 'text/html',
    'css': 'text/css',
    'js': 'application/javascript',
    'jsx': 'application/javascript',
    'ts': 'application/typescript',
    'tsx': 'application/typescript',
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'svg': 'image/svg+xml',
    'zip': 'application/zip',
  };
  return mimeMap[ext] || 'application/octet-stream';
}
