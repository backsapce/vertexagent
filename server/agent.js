/**
 * Agent API Server
 *
 * Provides a `/agent` endpoint that executes shell commands on the host machine.
 * This server is meant to run alongside the Vite dev server and is proxied
 * via vite.config.js so the frontend can reach it at the same origin.
 *
 * Authentication flow:
 *   1. Client hits GET /agent → gets { status: 'ok', needsAuth: true }
 *   2. Server prints a temp token to console on startup
 *   3. Client sends POST /agent/connect { token: '<temp-token>' }
 *   4. Server validates, generates a long-lived token, saves it to .agent-token,
 *      and returns { token: '<long-lived-token>' }
 *   5. All subsequent POST /agent requests must include Authorization: Bearer <token>
 *
 * Endpoints:
 *   GET  /agent            → health check (returns { status, needsAuth })
 *   POST /agent/connect    → exchange temp token for long-lived token
 *   POST /agent            → execute a command  { cmd: "ls -la" }
 *                             returns { stdout, stderr, code }
 *   GET  /agent/files      → list files in working directory
 *   POST /agent/files      → create file or directory
 *   POST /agent/files/upload → upload a file
 *   DELETE /agent/files    → delete a file or directory
 *   GET  /agent/files/download → download a file
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = join(__dirname, '..', 'dist');
const WORKING_DIR = join(process.cwd(), '.vertex-agent');

const MIME_TYPES = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.ttf':  'font/ttf',
  '.webp': 'image/webp',
};

function serveStatic(res, filePath) {
  try {
    const data = readFileSync(filePath);
    const ext = extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const PORT = process.env.AGENT_PORT || 3099;
const MAX_TIMEOUT = 30_000; // 30 seconds max per command
const TOKEN_FILE = join(process.cwd(), '.agent-token');

// ─── Token management ────────────────────────────────────────────────────────

let tempToken = null;      // one-time token printed to console
let validTokens = new Set(); // long-lived tokens that grant access

function generateToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

/** Load persisted tokens from .agent-token file (one per line). */
function loadTokens() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const content = readFileSync(TOKEN_FILE, 'utf-8');
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const t of lines) validTokens.add(t);
      console.log(`[agent] Loaded ${validTokens.size} saved token(s) from ${TOKEN_FILE}`);
    }
  } catch (err) {
    console.warn('[agent] Could not read token file:', err.message);
  }
}

/** Persist all valid tokens to .agent-token file. */
function saveTokens() {
  try {
    writeFileSync(TOKEN_FILE, [...validTokens].join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.warn('[agent] Could not save token file:', err.message);
  }
}

/** Check if the Authorization header carries a valid token. */
function isAuthorized(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return validTokens.has(token);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function execCommand(cmd, timeout = MAX_TIMEOUT) {
  return new Promise((resolve) => {
    exec(cmd, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: error ? error.code ?? 1 : 0,
      });
    });
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS_HEADERS });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Health check ───────────────────────────────────────────────────────
  if (url.pathname === '/agent' && req.method === 'GET') {
    const authed = isAuthorized(req);

    // Rotate temp token on every unauthenticated check so the console
    // always shows a fresh code the client can use.
    if (!authed) {
      tempToken = generateToken(6);
      console.log(`\n[agent] ─── Fresh temp connect token ───`);
      console.log(`[agent]   ${tempToken}`);
      console.log(`[agent] ────────────────────────────────\n`);
    }

    return json(res, 200, {
      status: 'ok',
      needsAuth: !authed,
    });
  }

  // ── Token exchange (connect) ───────────────────────────────────────────
  if (url.pathname === '/agent/connect' && req.method === 'POST') {
    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    const { token } = parsed;
    if (!token || typeof token !== 'string') {
      return json(res, 400, { error: 'Missing or invalid "token" field' });
    }

    // Validate the temp token
    if (token !== tempToken) {
      return json(res, 403, { error: 'Invalid token. Check the server console for the correct token.' });
    }

    // Temp token used — invalidate it and generate a fresh one for future connects
    const longLivedToken = generateToken(48);
    validTokens.add(longLivedToken);
    saveTokens();

    // Regenerate temp token for next connect
    tempToken = generateToken(6); // short & easy to type
    console.log(`\n[agent] ─── New temp connect token ───`);
    console.log(`[agent]   ${tempToken}`);
    console.log(`[agent] ──────────────────────────────\n`);

    console.log('[agent] Client authenticated successfully. Long-lived token issued.');
    return json(res, 200, { token: longLivedToken });
  }

  // ── Execute command (requires auth) ────────────────────────────────────
  if (url.pathname === '/agent' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized. Connect first to obtain a valid token.' });
    }

    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    const { cmd } = parsed;
    if (!cmd || typeof cmd !== 'string') {
      return json(res, 400, { error: 'Missing or invalid "cmd" field' });
    }

    console.log(`[agent] exec: ${cmd}`);
    const result = await execCommand(cmd);
    console.log(`[agent] exit code: ${result.code}`);
    return json(res, 200, result);
  }

  // ── List files (requires auth) ─────────────────────────────────────────
  if (url.pathname === '/agent/files' && req.method === 'GET') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized. Connect first to obtain a valid token.' });
    }

    const searchParams = new URLSearchParams(url.search);
    const dirPath = searchParams.get('path') || '';

    try {
      // Security: resolve the path and ensure it's within WORKING_DIR
      const normalizedPath = normalize(dirPath);
      const fullPath = join(WORKING_DIR, normalizedPath);
      const resolvedPath = resolve(fullPath);

      // Ensure the resolved path starts with WORKING_DIR (prevent directory traversal)
      if (!resolvedPath.startsWith(WORKING_DIR)) {
        return json(res, 403, { error: 'Access denied: Path outside working directory' });
      }

      // Check if the directory exists
      if (!existsSync(resolvedPath)) {
        return json(res, 404, { error: 'Directory not found' });
      }

      const stats = statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return json(res, 400, { error: 'Not a directory' });
      }

      // List directory contents
      const entries = readdirSync(resolvedPath, { withFileTypes: true });
      const files = entries.map((entry) => {
        const entryPath = join(resolvedPath, entry.name);
        let size = 0;
        let lastModified = null;
        try {
          const entryStats = statSync(entryPath);
          size = entryStats.size;
          lastModified = entryStats.mtimeMs;
        } catch {
          // Ignore errors for files we can't stat
        }
        return {
          id: `${entry.isDirectory() ? 'dir' : 'file'}-${normalizedPath}-${entry.name}`,
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size,
          lastModified,
          path: join(normalizedPath, entry.name),
          parentDir: normalizedPath === '.' ? '' : normalizedPath,
        };
      });

      // Return tree structure for root, array for subdirectories
      const result = normalizedPath === '.' || normalizedPath === ''
        ? { id: 'root', name: '/', type: 'directory', children: files }
        : files;

      return json(res, 200, result);
    } catch (err) {
      console.error(`[agent] Error listing files: ${err.message}`);
      return json(res, 500, { error: 'Failed to list files' });
    }
  }

  // ── Create file/directory (requires auth) ──────────────────────────────
  if (url.pathname === '/agent/files' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized. Connect first to obtain a valid token.' });
    }

    const body = await readBody(req);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      return json(res, 400, { error: 'Invalid JSON body' });
    }

    const { path, content, isDirectory } = parsed;
    if (!path || typeof path !== 'string') {
      return json(res, 400, { error: 'Missing or invalid "path" field' });
    }

    try {
      const normalizedPath = normalize(path);
      const fullPath = join(WORKING_DIR, normalizedPath);
      const resolvedPath = resolve(fullPath);

      // Ensure the resolved path starts with WORKING_DIR
      if (!resolvedPath.startsWith(WORKING_DIR)) {
        return json(res, 403, { error: 'Access denied: Path outside working directory' });
      }

      if (isDirectory) {
        // Create directory
        mkdirSync(resolvedPath, { recursive: true });
        return json(res, 200, { success: true, message: 'Directory created' });
      } else {
        // Create file - ensure parent directory exists
        const parentDir = join(resolvedPath, '..');
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(resolvedPath, content || '');
        return json(res, 200, { success: true, message: 'File created' });
      }
    } catch (err) {
      console.error(`[agent] Error creating file: ${err.message}`);
      return json(res, 500, { error: 'Failed to create file' });
    }
  }

  // ── Upload file (requires auth) ────────────────────────────────────────
  if (url.pathname === '/agent/files/upload' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized. Connect first to obtain a valid token.' });
    }

    try {
      // Parse multipart form data manually
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) {
        return json(res, 400, { error: 'Invalid multipart form data' });
      }

      const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
      const body = await readBody(req);
      
      // Split by boundary
      const parts = body.split(boundary);
      let filePath = '';
      let fileContent = null;

      for (const part of parts) {
        if (!part.trim() || part === '--' || part === '-') continue;
        
        // Remove leading CRLF from boundary
        const cleanPart = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
        
        const [headers, ...contentParts] = cleanPart.split(/\r?\n\r?\n/);
        const content = contentParts.join('\r\n\r\n');

        // Parse headers
        const contentDisposition = headers.match(/Content-Disposition:\s*form-data;\s*(.*)/i);
        if (contentDisposition) {
          const nameMatch = contentDisposition[1].match(/name="([^"]+)"/);
          const filenameMatch = contentDisposition[1].match(/filename="([^"]+)"/);
          
          if (nameMatch && nameMatch[1] === 'path') {
            filePath = content.trim();
          }
          if (filenameMatch) {
            // Decode the file content (handle base64 or raw binary)
            fileContent = Buffer.from(content.trim(), 'binary');
          }
        }
      }

      if (!filePath && fileContent === null) {
        return json(res, 400, { error: 'Missing file or path' });
      }

      const normalizedPath = normalize(filePath);
      const fullPath = join(WORKING_DIR, normalizedPath);
      const resolvedPath = resolve(fullPath);

      // Ensure the resolved path starts with WORKING_DIR
      if (!resolvedPath.startsWith(WORKING_DIR)) {
        return json(res, 403, { error: 'Access denied: Path outside working directory' });
      }

      // Ensure parent directory exists
      const parentDir = join(resolvedPath, '..');
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(resolvedPath, fileContent || '');
      return json(res, 200, { success: true, message: 'File uploaded' });
    } catch (err) {
      console.error(`[agent] Error uploading file: ${err.message}`);
      return json(res, 500, { error: 'Failed to upload file' });
    }
  }

  // ── Delete file/directory (requires auth) ──────────────────────────────
  if (url.pathname === '/agent/files' && req.method === 'DELETE') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized. Connect first to obtain a valid token.' });
    }

    const searchParams = new URLSearchParams(url.search);
    const filePath = searchParams.get('path') || '';

    if (!filePath) {
      return json(res, 400, { error: 'Missing "path" parameter' });
    }

    try {
      const normalizedPath = normalize(filePath);
      const fullPath = join(WORKING_DIR, normalizedPath);
      const resolvedPath = resolve(fullPath);

      // Ensure the resolved path starts with WORKING_DIR
      if (!resolvedPath.startsWith(WORKING_DIR)) {
        return json(res, 403, { error: 'Access denied: Path outside working directory' });
      }

      // Check if the path exists
      if (!existsSync(resolvedPath)) {
        return json(res, 404, { error: 'File or directory not found' });
      }

      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        // Remove directory recursively
        rmdirSync(resolvedPath, { recursive: true });
      } else {
        // Remove file
        unlinkSync(resolvedPath);
      }

      return json(res, 200, { success: true, message: 'Deleted successfully' });
    } catch (err) {
      console.error(`[agent] Error deleting file: ${err.message}`);
      return json(res, 500, { error: 'Failed to delete file' });
    }
  }

  // ── Download file (requires auth) ──────────────────────────────────────
  if (url.pathname === '/agent/files/download' && req.method === 'GET') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized. Connect first to obtain a valid token.' });
    }

    const searchParams = new URLSearchParams(url.search);
    const filePath = searchParams.get('path') || '';

    if (!filePath) {
      return json(res, 400, { error: 'Missing "path" parameter' });
    }

    try {
      const normalizedPath = normalize(filePath);
      const fullPath = join(WORKING_DIR, normalizedPath);
      const resolvedPath = resolve(fullPath);

      // Ensure the resolved path starts with WORKING_DIR
      if (!resolvedPath.startsWith(WORKING_DIR)) {
        return json(res, 403, { error: 'Access denied: Path outside working directory' });
      }

      // Check if the path exists and is a file
      if (!existsSync(resolvedPath)) {
        return json(res, 404, { error: 'File not found' });
      }

      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        return json(res, 400, { error: 'Cannot download a directory' });
      }

      const fileData = readFileSync(resolvedPath);
      const fileName = join(normalizedPath).split(/[\\/]/).pop();
      
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        ...CORS_HEADERS,
      });
      res.end(fileData);
    } catch (err) {
      console.error(`[agent] Error downloading file: ${err.message}`);
      return json(res, 500, { error: 'Failed to download file' });
    }
  }

  // ── Serve static frontend assets ──────────────────────────────────────
  let filePath = join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (serveStatic(res, filePath)) return;

  // SPA fallback — serve index.html for unmatched routes
  filePath = join(STATIC_DIR, 'index.html');
  if (serveStatic(res, filePath)) return;

  json(res, 404, { error: 'Not found' });
});

// ─── Start ───────────────────────────────────────────────────────────────────

loadTokens();

server.listen(PORT, () => {
  // make sure working directory exists
  try {
    // mkdir -p
    if (!existsSync(WORKING_DIR)) {
      mkdirSync(WORKING_DIR, { recursive: true });
      console.log(`[agent] Created working directory at ${WORKING_DIR}`);
    }
  } catch (err) {
    console.warn(`[agent] Could not create working directory: ${err.message}`);
  }

  console.log(`[agent] Server listening on http://localhost:${PORT}/agent`);
});