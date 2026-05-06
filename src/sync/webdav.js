/**
 * WebDAV Client for Browser
 * Implements PROPFIND, PUT, GET, MKCOL, DELETE methods over fetch().
 * Uses Basic Auth for username/password authentication.
 */

const DAV_NAMESPACE = 'D:';

function makeAuthHeader(username, password) {
  return 'Basic ' + btoa(`${username}:${password}`);
}

function normalizeUrl(url) {
  return url.replace(/\/+$/, '');
}

/**
 * Parse a PROPFIND XML response into an array of file entries.
 * Each entry: { href, displayName, isCollection, contentLength, etag, lastModified }
 */
function parsePropfindResponse(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error('Failed to parse WebDAV XML response');
  }

  const responses = doc.querySelectorAll('response');
  const entries = [];

  for (const response of responses) {
    const href = response.querySelector('href')?.textContent?.trim() || '';
    const propstat = response.querySelector('propstat');
    if (!propstat) continue;

    const status = propstat.querySelector('status')?.textContent?.trim() || '';
    if (!status.includes('200')) continue;

    const prop = propstat.querySelector('prop');
    if (!prop) continue;

    const isCollection = prop.querySelector('resourcetype > collection') !== null;
    const displayName = prop.querySelector('displayname')?.textContent?.trim() || '';
    const contentLength = parseInt(prop.querySelector('getcontentlength')?.textContent || '0', 10);
    const getetag = prop.querySelector('getetag')?.textContent?.trim() || '';
    const lastModified = prop.querySelector('getlastmodified')?.textContent?.trim() || '';

    entries.push({
      href,
      displayName: displayName || href.split('/').filter(Boolean).pop() || '',
      isCollection,
      contentLength,
      etag: getetag,
      lastModified,
    });
  }

  return entries;
}

/**
 * Handle HTTP response, throwing on non-OK status.
 */
async function checkResponse(response, operation) {
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`WebDAV ${operation} failed: ${response.status} ${response.statusText}${body ? ' - ' + body.slice(0, 200) : ''}`);
  }
  return response;
}

/**
 * Test if a WebDAV server is reachable and credentials are valid.
 */
export async function testConnection(url, username, password) {
  const baseUrl = normalizeUrl(url);
  const response = await fetch(baseUrl + '/', {
    method: 'PROPFIND',
    headers: {
      'Authorization': makeAuthHeader(username, password),
      'Depth': '0',
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
      <propfind xmlns="${DAV_NAMESPACE}">
        <prop><resourcetype/></prop>
      </propfind>`,
  });

  await checkResponse(response, 'PROPFIND (test)');
  return true;
}

/**
 * PROPFIND - List files/directories at a given path.
 */
export async function propfind(url, username, password, path = '/', depth = 1) {
  const baseUrl = normalizeUrl(url);
  const targetPath = path.startsWith('/') ? path : '/' + path;
  const response = await fetch(baseUrl + targetPath, {
    method: 'PROPFIND',
    headers: {
      'Authorization': makeAuthHeader(username, password),
      'Depth': String(depth),
      'Content-Type': 'application/xml; charset=utf-8',
    },
    body: `<?xml version="1.0" encoding="utf-8" ?>
      <propfind xmlns="${DAV_NAMESPACE}">
        <prop>
          <resourcetype/>
          <displayname/>
          <getcontentlength/>
          <getetag/>
          <getlastmodified/>
        </prop>
      </propfind>`,
  });

  await checkResponse(response, 'PROPFIND');
  const xmlText = await response.text();
  const entries = parsePropfindResponse(xmlText);

  return entries.map(entry => {
    let cleanHref = entry.href;
    try {
      const urlObj = new URL(cleanHref, baseUrl);
      cleanHref = decodeURIComponent(urlObj.pathname);
    } catch {
      // already a relative path
    }
    return { ...entry, href: cleanHref };
  });
}

/**
 * PUT - Upload content to the WebDAV server.
 */
export async function putFile(url, username, password, remotePath, content, mimeType = 'application/octet-stream') {
  const baseUrl = normalizeUrl(url);
  const targetPath = remotePath.startsWith('/') ? remotePath : '/' + remotePath;

  const response = await fetch(baseUrl + targetPath, {
    method: 'PUT',
    headers: {
      'Authorization': makeAuthHeader(username, password),
      'Content-Type': mimeType,
    },
    body: content,
  });

  await checkResponse(response, 'PUT');
}

/**
 * GET - Download a file from the WebDAV server.
 * Returns the response body as an ArrayBuffer.
 */
export async function getFile(url, username, password, remotePath) {
  const baseUrl = normalizeUrl(url);
  const targetPath = remotePath.startsWith('/') ? remotePath : '/' + remotePath;

  const response = await fetch(baseUrl + targetPath, {
    method: 'GET',
    headers: {
      'Authorization': makeAuthHeader(username, password),
    },
  });

  await checkResponse(response, 'GET');
  return response.arrayBuffer();
}

/**
 * GET text content of a file.
 */
export async function getFileText(url, username, password, remotePath) {
  const buffer = await getFile(url, username, password, remotePath);
  return new TextDecoder().decode(buffer);
}

/**
 * MKCOL - Create a directory. Succeeds if already exists (405).
 */
export async function mkcol(url, username, password, remotePath) {
  const baseUrl = normalizeUrl(url);
  const targetPath = remotePath.startsWith('/') ? remotePath : '/' + remotePath;

  const response = await fetch(baseUrl + targetPath, {
    method: 'MKCOL',
    headers: {
      'Authorization': makeAuthHeader(username, password),
    },
  });

  if (!response.ok && response.status !== 405) {
    const body = await response.text().catch(() => '');
    throw new Error(`WebDAV MKCOL failed: ${response.status} ${response.statusText}${body ? ' - ' + body.slice(0, 200) : ''}`);
  }
}

/**
 * DELETE - Remove a file or directory.
 */
export async function deleteEntry(url, username, password, remotePath) {
  const baseUrl = normalizeUrl(url);
  const targetPath = remotePath.startsWith('/') ? remotePath : '/' + remotePath;

  const response = await fetch(baseUrl + targetPath, {
    method: 'DELETE',
    headers: {
      'Authorization': makeAuthHeader(username, password),
    },
  });

  // 204 = success, 404 = already gone
  if (!response.ok && response.status !== 404) {
    const body = await response.text().catch(() => '');
    throw new Error(`WebDAV DELETE failed: ${response.status} ${response.statusText}${body ? ' - ' + body.slice(0, 200) : ''}`);
  }
}

/**
 * Ensure a directory path exists, creating each level as needed.
 */
export async function ensureDirectory(url, username, password, remotePath) {
  const normalized = (remotePath.startsWith('/') ? remotePath : '/' + remotePath).replace(/\/+$/, '');
  const parts = normalized.split('/').filter(Boolean);

  let builtPath = '';
  for (const part of parts) {
    builtPath += '/' + part;
    try {
      await mkcol(url, username, password, builtPath);
    } catch (_e) {
      // directory probably already exists
    }
  }
}

export { normalizeUrl };
