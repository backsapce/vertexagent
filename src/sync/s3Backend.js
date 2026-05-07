import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

function trimSlashes(value) {
  return String(value || '').replace(/^\/+|\/+$/g, '');
}

export function objectKey(config, suffix) {
  const prefix = trimSlashes(config.prefix);
  const cleanSuffix = trimSlashes(suffix);
  return prefix ? `${prefix}/${cleanSuffix}` : cleanSuffix;
}

function createClient(config) {
  return new S3Client({
    region: config.region || 'us-east-1',
    endpoint: config.endpoint || undefined,
    forcePathStyle: Boolean(config.forcePathStyle),
    credentials: {
      accessKeyId: config.accessKeyId || '',
      secretAccessKey: config.secretAccessKey || '',
    },
  });
}

async function bodyToBytes(body) {
  if (!body) return new Uint8Array();
  if (body.transformToByteArray) return body.transformToByteArray();
  if (body.getReader) {
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
  return new Uint8Array(await new Response(body).arrayBuffer());
}

export function createS3Backend(config) {
  const client = createClient(config);
  const bucket = config.bucket;

  async function getBytes(key) {
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return await bodyToBytes(res.Body);
    } catch (err) {
      if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NoSuchKey') return null;
      throw err;
    }
  }

  return {
    async test() {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    },

    async getJson(key, fallback = null) {
      const bytes = await getBytes(key);
      if (!bytes) return fallback;
      return JSON.parse(new TextDecoder().decode(bytes));
    },

    async getBytes(key) {
      return getBytes(key);
    },

    async putJson(key, data) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
      }));
    },

    async putBytes(key, bytes, contentType = 'application/octet-stream') {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: bytes,
        ContentType: contentType || 'application/octet-stream',
      }));
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
