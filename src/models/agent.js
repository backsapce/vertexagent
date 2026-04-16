/**
 * Agent client module.
 *
 * Provides helpers to check whether agent servers are reachable,
 * authenticate via temp-token exchange, and execute commands.
 * Supports multiple agent hosts.
 */

import config from '../config/config';

const DEFAULT_AGENT_PATH = '/agent';

/**
 * Normalise a host URL into a full agent endpoint.
 * - If the url already contains '/agent', use as-is.
 * - Otherwise append '/agent'.
 * @param {string} [url] - e.g. 'http://localhost:3099' or '/agent'
 * @returns {string}
 */
function resolveAgentUrl(url) {
  if (!url) return DEFAULT_AGENT_PATH;
  const u = url.replace(/\/+$/, '');
  return u.endsWith('/agent') ? u : `${u}/agent`;
}

/** Build a unique config key for a given agent URL's token. */
function tokenKey(url) {
  const base = (url || window.location.origin).replace(/[^a-zA-Z0-9]/g, '_');
  return `agentTokens.${base}`;
}

/** Get the saved long-lived token for a given agent URL. */
export function getAgentToken(url) {
  return config.get(tokenKey(url)) || null;
}

/** Save a long-lived token for a given agent URL. */
export async function saveAgentToken(url, token) {
  await config.set(tokenKey(url), token);
}

/** Clear the saved token for a given agent URL. */
export async function clearAgentToken(url) {
  await config.set(tokenKey(url), null);
}

/**
 * Check if the agent server is available (GET /agent returns 200).
 * Also returns whether the server requires authentication.
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<{ available: boolean, needsAuth: boolean }>}
 */
export async function checkAgentAvailable(url) {
  try {
    const endpoint = resolveAgentUrl(url);
    const headers = {};
    const token = getAgentToken(url);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(endpoint, { method: 'GET', headers });
    if (!res.ok) return { available: false, needsAuth: false };
    const data = await res.json();
    return {
      available: data.status === 'ok',
      needsAuth: !!data.needsAuth,
    };
  } catch {
    return { available: false, needsAuth: false };
  }
}

/**
 * Exchange a temp token (shown in server console) for a long-lived token.
 * The long-lived token is automatically saved to config.
 * @param {string} tempToken - The temp token from the server console.
 * @param {string} [url] - agent host URL.
 * @returns {Promise<string>} The long-lived token.
 */
export async function connectAgent(tempToken, url) {
  const base = resolveAgentUrl(url);
  // POST to /agent/connect
  const connectUrl = base.replace(/\/agent$/, '/agent/connect');
  const res = await fetch(connectUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: tempToken }),
  });
  const data = await res.json().catch(() => ({ error: 'Invalid response' }));
  if (!res.ok) {
    throw new Error(data.error || `Connect failed (${res.status})`);
  }
  if (!data.token) {
    throw new Error('Server did not return a token.');
  }
  // Persist the long-lived token
  await saveAgentToken(url, data.token);
  return data.token;
}

/**
 * Execute a shell command via the agent server.
 * Automatically attaches the saved auth token.
 * @param {string} cmd - The command to run.
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export async function executeCommand(cmd, url) {
  const endpoint = resolveAgentUrl(url);
  const headers = { 'Content-Type': 'application/json' };
  const token = getAgentToken(url);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ cmd }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
    throw new Error(err.error || `Agent returned ${res.status}`);
  }
  return res.json();
}

/**
 * List files from the agent server's working directory (.vertex-agent).
 * Automatically attaches the saved auth token.
 * @param {string} [path] - Directory path relative to working directory (empty for root).
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<{id: string, name: string, type: string, children: Array}|Array>}
 */
export async function listRemoteFiles(path = '', url) {
  const base = resolveAgentUrl(url);
  const filesUrl = `${base}/files${path ? `?path=${encodeURIComponent(path)}` : ''}`;
  const headers = {};
  const token = getAgentToken(url);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(filesUrl, { method: 'GET', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
    throw new Error(err.error || `Agent returned ${res.status}`);
  }
  return res.json();
}

/**
 * Create a file or directory on the remote agent server.
 * @param {string} path - Path relative to working directory
 * @param {string} [content] - File content (optional, empty string if not provided)
 * @param {boolean} [isDirectory] - If true, creates a directory instead of a file
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function createRemoteFile(path, content = '', isDirectory = false, url) {
  const base = resolveAgentUrl(url);
  const filesUrl = `${base}/files`;
  const headers = { 'Content-Type': 'application/json' };
  const token = getAgentToken(url);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(filesUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ path, content, isDirectory }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
    throw new Error(err.error || `Agent returned ${res.status}`);
  }
  return res.json();
}

/**
 * Delete a file or directory on the remote agent server.
 * @param {string} path - Path relative to working directory
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function deleteRemoteFile(path, url) {
  const base = resolveAgentUrl(url);
  const filesUrl = `${base}/files?path=${encodeURIComponent(path)}`;
  const headers = {};
  const token = getAgentToken(url);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(filesUrl, { method: 'DELETE', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
    throw new Error(err.error || `Agent returned ${res.status}`);
  }
  return res.json();
}

/**
 * Upload a file to the remote agent server.
 * @param {string} path - Path relative to working directory
 * @param {Blob|File} file - The file to upload
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function uploadRemoteFile(path, file, url) {
  const base = resolveAgentUrl(url);
  const uploadUrl = `${base}/files/upload`;
  
  // Create form data for multipart upload
  const formData = new FormData();
  formData.append('path', path);
  formData.append('file', file);

  const headers = {};
  const token = getAgentToken(url);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
    throw new Error(err.error || `Agent returned ${res.status}`);
  }
  return res.json();
}

/**
 * Download a file from the remote agent server.
 * @param {string} path - Path relative to working directory
 * @param {string} [url] - agent host URL (optional, defaults to local /agent)
 * @returns {Promise<Blob>}
 */
export async function downloadRemoteFile(path, url) {
  const base = resolveAgentUrl(url);
  const downloadUrl = `${base}/files/download?path=${encodeURIComponent(path)}`;
  const headers = {};
  const token = getAgentToken(url);
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(downloadUrl, { method: 'GET', headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Agent request failed' }));
    throw new Error(err.error || `Agent returned ${res.status}`);
  }
  return res.blob();
}
