/**
 * S3-compatible object storage client for browser sync.
 * Supports AWS S3, Aliyun OSS S3 API, MinIO, and other SigV4-compatible APIs.
 */

const DEFAULT_SERVICE = 's3';
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function normalizeEndpoint(endpoint) {
  if (!endpoint) throw new Error('S3 endpoint is required.');
  return endpoint.replace(/\/+$/, '');
}

function normalizePrefix(prefix = 'vertex-agent') {
  return String(prefix || '').replace(/^\/+|\/+$/g, '');
}

function normalizeRegion(region, endpoint) {
  if (region) return region;

  const host = new URL(normalizeEndpoint(endpoint)).hostname;
  const aliyunS3Match = host.match(/^s3\.oss-([^.]+)\.aliyuncs\.com$/);
  if (aliyunS3Match) return aliyunS3Match[1];

  const aliyunMatch = host.match(/^oss-([^.]+)\.aliyuncs\.com$/);
  if (aliyunMatch) return aliyunMatch[1];

  const awsMatch = host.match(/^s3[.-]([^.]+)\.amazonaws\.com$/);
  if (awsMatch) return awsMatch[1];

  return 'us-east-1';
}

function isIpAddress(hostname) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

function shouldUsePathStyle(options, endpointUrl) {
  if (typeof options.forcePathStyle === 'boolean') return options.forcePathStyle;

  const hostname = endpointUrl.hostname;
  return hostname === 'localhost' || hostname.endsWith('.localhost') || isIpAddress(hostname);
}

function isAliyunEndpoint(endpointUrl) {
  return /(?:^|\.)aliyuncs\.com$/.test(endpointUrl.hostname);
}

function assertConfig(options) {
  if (!options?.bucket) throw new Error('S3 bucket is required.');
  if (!options?.accessKeyId) throw new Error('S3 accessKeyId is required.');
  if (!options?.secretAccessKey) throw new Error('S3 secretAccessKey is required.');
  if (!options?.endpoint) throw new Error('S3 endpoint is required.');
}

function encodePathSegment(segment) {
  return encodeURIComponent(segment).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function encodeCanonicalUri(path) {
  return '/' + String(path || '').split('/').filter(Boolean).map(encodePathSegment).join('/');
}

function encodeQuery(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildQueryString(params = {}) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeQuery(key)}=${encodeQuery(value)}`)
    .join('&');
}

function arrayBufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function stringToBytes(value) {
  return new TextEncoder().encode(value);
}

async function sha256Hex(value) {
  if (value == null || value === '') return EMPTY_SHA256;

  const bytes = typeof value === 'string'
    ? stringToBytes(value)
    : value instanceof Blob
      ? new Uint8Array(await value.arrayBuffer())
      : value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : value;

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return arrayBufferToHex(digest);
}

async function hmac(key, value) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, stringToBytes(value));
  return new Uint8Array(signature);
}

async function hmacHex(key, value) {
  return arrayBufferToHex(await hmac(key, value));
}

async function getSigningKey(secretAccessKey, dateStamp, region, service = DEFAULT_SERVICE) {
  const kDate = await hmac(stringToBytes(`AWS4${secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

function toAmzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function buildObjectKey(options, key = '') {
  const prefix = normalizePrefix(options.prefix);
  const rawKey = String(key || '');
  if (prefix && rawKey === '/') return `${prefix}/`;
  const cleanKey = rawKey.replace(/^\/+/g, '');
  return [prefix, cleanKey].filter(Boolean).join('/');
}

function buildUrl(options, key = '', query = {}) {
  const endpoint = normalizeEndpoint(options.endpoint);
  const baseUrl = new URL(endpoint);
  const objectKey = buildObjectKey(options, key);
  const bucket = options.bucket;

  let path;
  if (shouldUsePathStyle(options, baseUrl)) {
    path = [bucket, objectKey].filter(Boolean).join('/');
  } else {
    baseUrl.hostname = `${bucket}.${baseUrl.hostname}`;
    path = objectKey;
  }

  baseUrl.pathname = encodeCanonicalUri(path);
  baseUrl.search = buildQueryString(query);
  return baseUrl;
}

function canonicalizeHeaders(headers) {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')])
    .sort(([a], [b]) => a.localeCompare(b));

  return {
    canonicalHeaders: entries.map(([key, value]) => `${key}:${value}\n`).join(''),
    signedHeaders: entries.map(([key]) => key).join(';'),
  };
}

async function signedFetch(options, method, key = '', { query, body, contentType } = {}) {
  assertConfig(options);
  const { url, headers: fetchHeaders } = await buildSignedRequest(options, method, key, { query, body, contentType });

  const response = await fetch(url.toString(), {
    method,
    headers: fetchHeaders,
    body,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(formatS3Error(method, response, text));
  }

  return response;
}

function formatS3Error(method, response, text) {
  const fallback = `S3 ${method} failed: ${response.status} ${response.statusText}`;
  if (!text) return fallback;

  try {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const code = doc.querySelector('Code')?.textContent?.trim();
    const message = doc.querySelector('Message')?.textContent?.trim();
    if (code || message) {
      return `${fallback}${code ? ` (${code})` : ''}${message ? ` - ${message}` : ''}`;
    }
  } catch {
    // Keep the raw response fallback below.
  }

  return `${fallback} - ${text.slice(0, 200)}`;
}

export async function buildSignedRequest(options, method, key = '', { query, body, contentType, date } = {}) {
  assertConfig(options);

  const url = buildUrl(options, key, query);
  const region = normalizeRegion(options.region, options.endpoint);
  const service = options.service || DEFAULT_SERVICE;
  const amzDate = toAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (isAliyunEndpoint(url)) {
    headers['x-oss-s3-compat'] = 'true';
  }

  if (contentType) {
    headers['content-type'] = contentType;
  }

  const { canonicalHeaders, signedHeaders } = canonicalizeHeaders(headers);
  const canonicalRequest = [
    method,
    url.pathname,
    url.search.slice(1),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSigningKey(options.secretAccessKey, dateStamp, region, service);
  const signature = await hmacHex(signingKey, stringToSign);

  const fetchHeaders = {
    ...headers,
    Authorization: `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  delete fetchHeaders.host;

  return { url, headers: fetchHeaders, signature, canonicalRequest, stringToSign };
}

function parseListObjectsXml(xmlText) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const parseError = doc.querySelector('parsererror');
  if (parseError) throw new Error('Failed to parse S3 ListObjectsV2 XML response');

  return {
    isTruncated: doc.querySelector('IsTruncated')?.textContent === 'true',
    nextContinuationToken: doc.querySelector('NextContinuationToken')?.textContent || null,
    objects: Array.from(doc.querySelectorAll('Contents')).map(item => ({
      key: item.querySelector('Key')?.textContent || '',
      size: Number(item.querySelector('Size')?.textContent || 0),
      etag: item.querySelector('ETag')?.textContent?.replace(/^"|"$/g, '') || '',
      lastModified: item.querySelector('LastModified')?.textContent || '',
    })),
  };
}

export async function testConnection(options) {
  await assertPrefixExists(options);
  return true;
}

export async function assertPrefixExists(options) {
  const prefix = normalizePrefix(options.prefix);
  if (!prefix) return;

  const objects = await listObjects(options, { maxKeys: 1 });
  if (objects.length === 0) {
    throw new Error(`S3 prefix "${prefix}/" does not exist. Please create it in your bucket first.`);
  }
}

export async function listObjects(options, { maxKeys = 1000 } = {}) {
  assertConfig(options);

  const prefix = normalizePrefix(options.prefix);
  const objects = [];
  let continuationToken = null;

  do {
    const query = {
      'list-type': '2',
      prefix: prefix ? `${prefix}/` : '',
      'max-keys': maxKeys,
      'continuation-token': continuationToken,
    };

    const response = await signedFetch(options, 'GET', '', { query });
    const page = parseListObjectsXml(await response.text());
    objects.push(...page.objects);
    continuationToken = page.isTruncated ? page.nextContinuationToken : null;
  } while (continuationToken);

  return objects;
}

export async function putObject(options, key, content, contentType = 'application/octet-stream') {
  await signedFetch(options, 'PUT', key, { body: content ?? '', contentType });
}

export async function getObjectText(options, key) {
  const response = await signedFetch(options, 'GET', key);
  return response.text();
}

export async function deleteObject(options, key) {
  try {
    await signedFetch(options, 'DELETE', key);
  } catch (err) {
    if (!String(err.message).includes('404')) throw err;
  }
}

export function toLocalPath(options, objectKey) {
  const prefix = normalizePrefix(options.prefix);
  const normalizedPrefix = prefix ? `${prefix}/` : '';
  return objectKey.startsWith(normalizedPrefix)
    ? objectKey.slice(normalizedPrefix.length)
    : objectKey;
}
