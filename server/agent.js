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
 *   4. Server validates, generates a long-lived token, saves it to token file,
 *      and returns { token: '<long-lived-token>' }
 *   5. All subsequent POST /agent requests must include Authorization: Bearer <token>
 *
 * Security features:
 *   - Command validation (blocks destructive patterns)
 *   - Rate limiting on connect and command endpoints
 *   - CORS restricted to allowed origins (not wildcard)
 *   - Path traversal protection with normalized comparison
 *   - Higher-entropy temp tokens (8 bytes = 16 hex chars)
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, unlinkSync, rmSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const STATIC_DIR = join(__dirname, '..', 'dist');
const WORKING_DIR = resolve(join(process.cwd(), '.vertex-agent'));

// ─── Configuration ──────────────────────────────────────────────────────────

const PORT = process.env.AGENT_PORT || 3099;
const MAX_TIMEOUT = 30_000;
const TOKEN_FILE = process.env.AGENT_TOKEN_FILE || join(process.cwd(), '.agent-token');
const ALLOWED_ORIGINS = (process.env.AGENT_ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

// ─── MIME types ─────────────────────────────────────────────────────────────

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
  if (res.writableEnded) return true;
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

// ─── CORS ───────────────────────────────────────────────────────────────────

function corsHeaders(req) {
  const origin = req.headers['origin'] || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ─── Rate limiting ──────────────────────────────────────────────────────────

const rateLimits = new Map(); // key → { count, resetAt }

function isRateLimited(key, maxRequests, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now >= entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > maxRequests;
}

// ─── Token management ───────────────────────────────────────────────────────

let tempToken = null;
const validTokens = new Set();

function generateToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

function loadTokens() {
  try {
    if (existsSync(TOKEN_FILE)) {
      const content = readFileSync(TOKEN_FILE, 'utf-8');
      const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const t of lines) validTokens.add(t);
      console.log(`[agent] Loaded ${validTokens.size} saved token(s)`);
    }
  } catch (err) {
    console.warn('[agent] Could not read token file:', err.message);
  }
}

function saveTokens() {
  try {
    writeFileSync(TOKEN_FILE, [...validTokens].join('\n') + '\n', 'utf-8');
  } catch (err) {
    console.warn('[agent] Could not save token file:', err.message);
  }
}

function isAuthorized(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  return validTokens.has(token);
}

// ─── Command validation ─────────────────────────────────────────────────────

const BLOCKED_PATTERNS = [
  /rm\s+(-rf|--recursive|--force)\s+\/\s*$/,   // rm -rf /
  /dd\s+if=/,                                   // dd (disk operations)
  /mkfs/,                                       // filesystem format
  /:()\s*\{\s*:\|:\s*\}/,                         // fork bomb
  />\s*\/dev\/sd/,                              // write to raw disk
  /chmod\s+[0-7]*\s+\/\s*$/,                    // chmod on root
  /curl\s+.+\s*\|\s*sh/,                        // pipe curl to shell
  /wget\s+.+\s*\|\s*sh/,                        // pipe wget to shell
];

function validateCommand(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return { blocked: true, reason: `Command matches blocked pattern: ${pattern.source}` };
    }
  }
  return { blocked: false };
}

// ─── Path safety ────────────────────────────────────────────────────────────

function isSafePath(inputPath) {
  const normalizedPath = normalize(inputPath);
  // Reject paths containing .. after normalization (should already be resolved, but double-check)
  if (normalizedPath.includes('..')) return false;
  const fullPath = join(WORKING_DIR, normalizedPath);
  const resolvedPath = resolve(fullPath);
  // On Windows, compare case-insensitively
  const compareA = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
  const compareB = process.platform === 'win32' ? WORKING_DIR.toLowerCase() : WORKING_DIR;
  return compareA.startsWith(compareB + sep) || compareA === compareB;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function json(res, status, data, req) {
  if (res.writableEnded) return;
  const headers = { 'Content-Type': 'application/json', ...corsHeaders(req) };
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body;
}

// ─── Server ─────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  try {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    if (res.writableEnded) return;
    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ── Health check ───────────────────────────────────────────────────────
  if (url.pathname === '/agent' && req.method === 'GET') {
    const authed = isAuthorized(req);

    if (!authed) {
      tempToken = generateToken(8);
      console.log(`\n[agent] ─── Fresh temp connect token ───`);
      console.log(`[agent]   ${tempToken}`);
      console.log(`[agent] ────────────────────────────────\n`);
    }

    return json(res, 200, { status: 'ok', needsAuth: !authed }, req);
  }

  // ── Token exchange (connect) ───────────────────────────────────────────
  if (url.pathname === '/agent/connect' && req.method === 'POST') {
    const clientIp = req.socket.remoteAddress;
    if (isRateLimited(`connect:${clientIp}`, 5, 60_000)) {
      return json(res, 429, { error: 'Too many connect attempts. Try again later.' }, req);
    }

    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      return json(res, 400, { error: 'Invalid JSON body' }, req);
    }

    const { token } = parsed;
    if (!token || typeof token !== 'string') {
      return json(res, 400, { error: 'Missing or invalid "token" field' }, req);
    }

    if (token !== tempToken) {
      return json(res, 403, { error: 'Invalid token. Check the server console for the correct token.' }, req);
    }

    const longLivedToken = generateToken(48);
    validTokens.add(longLivedToken);
    saveTokens();

    tempToken = generateToken(8);
    console.log(`\n[agent] ─── New temp connect token ───`);
    console.log(`[agent]   ${tempToken}`);
    console.log(`[agent] ──────────────────────────────\n`);

    console.log('[agent] Client authenticated successfully.');
    return json(res, 200, { token: longLivedToken }, req);
  }

  // ── Execute command (requires auth) ────────────────────────────────────
  if (url.pathname === '/agent' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized.' }, req);
    }

    const clientIp = req.socket.remoteAddress;
    if (isRateLimited(`cmd:${clientIp}`, 30, 60_000)) {
      return json(res, 429, { error: 'Too many commands. Slow down.' }, req);
    }

    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      return json(res, 400, { error: 'Invalid JSON body' }, req);
    }

    const { cmd } = parsed;
    if (!cmd || typeof cmd !== 'string') {
      return json(res, 400, { error: 'Missing or invalid "cmd" field' }, req);
    }

    const validation = validateCommand(cmd);
    if (validation.blocked) {
      console.warn(`[agent] BLOCKED command: ${cmd} (${validation.reason})`);
      return json(res, 403, { error: `Command blocked: ${validation.reason}` }, req);
    }

    console.log(`[agent] exec: ${cmd}`);
    const result = await execCommand(cmd);
    console.log(`[agent] exit code: ${result.code}`);
    return json(res, 200, result, req);
  }

  // ── List files (requires auth) ─────────────────────────────────────────
  if (url.pathname === '/agent/files' && req.method === 'GET') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized.' }, req);
    }

    const searchParams = new URLSearchParams(url.search);
    const dirPath = searchParams.get('path') || '';

    if (!isSafePath(dirPath)) {
      return json(res, 403, { error: 'Access denied: Path outside working directory' }, req);
    }

    try {
      const normalizedPath = normalize(dirPath);
      const resolvedPath = resolve(join(WORKING_DIR, normalizedPath));

      if (!existsSync(resolvedPath)) {
        return json(res, 404, { error: 'Directory not found' }, req);
      }

      const stats = statSync(resolvedPath);
      if (!stats.isDirectory()) {
        return json(res, 400, { error: 'Not a directory' }, req);
      }

      const entries = readdirSync(resolvedPath, { withFileTypes: true });
      const files = entries.map((entry) => {
        const entryPath = join(resolvedPath, entry.name);
        let size = 0;
        let lastModified = null;
        try {
          const entryStats = statSync(entryPath);
          size = entryStats.size;
          lastModified = entryStats.mtimeMs;
        } catch { /* ignore */ }
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

      const result = normalizedPath === '.' || normalizedPath === ''
        ? { id: 'root', name: '/', type: 'directory', children: files }
        : files;

      return json(res, 200, result, req);
    } catch (err) {
      console.error(`[agent] Error listing files: ${err.message}`);
      return json(res, 500, { error: 'Failed to list files' }, req);
    }
  }

  // ── Create file/directory (requires auth) ──────────────────────────────
  if (url.pathname === '/agent/files' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized.' }, req);
    }

    const body = await readBody(req);
    let parsed;
    try { parsed = JSON.parse(body); } catch {
      return json(res, 400, { error: 'Invalid JSON body' }, req);
    }

    const { path, content, isDirectory } = parsed;
    if (!path || typeof path !== 'string') {
      return json(res, 400, { error: 'Missing or invalid "path" field' }, req);
    }

    if (!isSafePath(path)) {
      return json(res, 403, { error: 'Access denied: Path outside working directory' }, req);
    }

    try {
      const resolvedPath = resolve(join(WORKING_DIR, normalize(path)));

      if (isDirectory) {
        mkdirSync(resolvedPath, { recursive: true });
        return json(res, 200, { success: true, message: 'Directory created' }, req);
      } else {
        const parentDir = join(resolvedPath, '..');
        if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
        writeFileSync(resolvedPath, content || '');
        return json(res, 200, { success: true, message: 'File created' }, req);
      }
    } catch (err) {
      console.error(`[agent] Error creating file: ${err.message}`);
      return json(res, 500, { error: 'Failed to create file' }, req);
    }
  }

  // ── Upload file (requires auth) ────────────────────────────────────────
  if (url.pathname === '/agent/files/upload' && req.method === 'POST') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized.' }, req);
    }

    try {
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
      if (!boundaryMatch) {
        return json(res, 400, { error: 'Invalid multipart form data' }, req);
      }

      const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;
      const body = await readBody(req);
      const parts = body.split(boundary);
      let filePath = '';
      let fileContent = null;

      for (const part of parts) {
        if (!part.trim() || part === '--' || part === '-') continue;
        const cleanPart = part.replace(/^\r?\n/, '').replace(/\r?\n$/, '');
        const [headers, ...contentParts] = cleanPart.split(/\r?\n\r?\n/);
        const content = contentParts.join('\r\n\r\n');
        const contentDisposition = headers.match(/Content-Disposition:\s*form-data;\s*(.*)/i);
        if (contentDisposition) {
          const nameMatch = contentDisposition[1].match(/name="([^"]+)"/);
          const filenameMatch = contentDisposition[1].match(/filename="([^"]+)"/);
          if (nameMatch && nameMatch[1] === 'path') filePath = content.trim();
          if (filenameMatch) fileContent = Buffer.from(content.trim(), 'binary');
        }
      }

      if (!filePath && fileContent === null) {
        return json(res, 400, { error: 'Missing file or path' }, req);
      }

      if (!isSafePath(filePath)) {
        return json(res, 403, { error: 'Access denied: Path outside working directory' }, req);
      }

      const resolvedPath = resolve(join(WORKING_DIR, normalize(filePath)));
      const parentDir = join(resolvedPath, '..');
      if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true });
      writeFileSync(resolvedPath, fileContent || '');
      return json(res, 200, { success: true, message: 'File uploaded' }, req);
    } catch (err) {
      console.error(`[agent] Error uploading file: ${err.message}`);
      return json(res, 500, { error: 'Failed to upload file' }, req);
    }
  }

  // ── Delete file/directory (requires auth) ──────────────────────────────
  if (url.pathname === '/agent/files' && req.method === 'DELETE') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized.' }, req);
    }

    const searchParams = new URLSearchParams(url.search);
    const filePath = searchParams.get('path') || '';

    if (!filePath) {
      return json(res, 400, { error: 'Missing "path" parameter' }, req);
    }

    if (!isSafePath(filePath)) {
      return json(res, 403, { error: 'Access denied: Path outside working directory' }, req);
    }

    try {
      const resolvedPath = resolve(join(WORKING_DIR, normalize(filePath)));
      if (!existsSync(resolvedPath)) {
        return json(res, 404, { error: 'File or directory not found' }, req);
      }
      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        rmSync(resolvedPath, { recursive: true });
      } else {
        unlinkSync(resolvedPath);
      }
      return json(res, 200, { success: true, message: 'Deleted successfully' }, req);
    } catch (err) {
      console.error(`[agent] Error deleting file: ${err.message}`);
      return json(res, 500, { error: 'Failed to delete file' }, req);
    }
  }

  // ── Download file (requires auth) ──────────────────────────────────────
  if (url.pathname === '/agent/files/download' && req.method === 'GET') {
    if (!isAuthorized(req)) {
      return json(res, 401, { error: 'Unauthorized.' }, req);
    }

    const searchParams = new URLSearchParams(url.search);
    const filePath = searchParams.get('path') || '';

    if (!filePath) {
      return json(res, 400, { error: 'Missing "path" parameter' }, req);
    }

    if (!isSafePath(filePath)) {
      return json(res, 403, { error: 'Access denied: Path outside working directory' }, req);
    }

    try {
      const resolvedPath = resolve(join(WORKING_DIR, normalize(filePath)));
      if (!existsSync(resolvedPath)) {
        return json(res, 404, { error: 'File not found' }, req);
      }
      const stats = statSync(resolvedPath);
      if (stats.isDirectory()) {
        return json(res, 400, { error: 'Cannot download a directory' }, req);
      }
      const fileData = readFileSync(resolvedPath);
      const fileName = normalize(filePath).split(/[\\/]/).pop();
      if (res.writableEnded) return;
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        ...corsHeaders(req),
      });
      res.end(fileData);
    } catch (err) {
      console.error(`[agent] Error downloading file: ${err.message}`);
      return json(res, 500, { error: 'Failed to download file' }, req);
    }
  }

  // ── Serve static frontend assets ──────────────────────────────────────
  let staticPath = join(STATIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (serveStatic(res, staticPath)) return;

  staticPath = join(STATIC_DIR, 'index.html');
  if (serveStatic(res, staticPath)) return;

  json(res, 404, { error: 'Not found' }, req);
  } catch (err) {
    console.error(`[agent] Unhandled error: ${err.message}`);
    json(res, 500, { error: 'Internal server error' }, req);
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

loadTokens();

server.listen(PORT, () => {
  try {
    if (!existsSync(WORKING_DIR)) {
      mkdirSync(WORKING_DIR, { recursive: true });
      console.log(`[agent] Created working directory at ${WORKING_DIR}`);
    }
  } catch (err) {
    console.warn(`[agent] Could not create working directory: ${err.message}`);
  }

  console.log(`[agent] Server listening on http://localhost:${PORT}/agent`);
  console.log(`[agent] Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});