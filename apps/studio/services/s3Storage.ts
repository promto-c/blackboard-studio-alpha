import {
  STORAGE_MOUNT_RESOURCES,
  createObjectStorageAdapter,
  registerStorageMount,
  unmountStorage,
  type ObjectStorageClient,
} from '@blackboard/project-store';

export interface S3StorageConfig {
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  forcePathStyle: boolean;
}

const activeS3Mounts = new Map<string, () => void>();
const textEncoder = new TextEncoder();

const toHex = (value: ArrayBuffer): string =>
  Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');

const readBlob = (value: Blob): Promise<ArrayBuffer> => {
  if (typeof value.arrayBuffer === 'function') return value.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('Could not read object data.'));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(value);
  });
};

const sha256 = async (value: string | Blob): Promise<string> => {
  const bytes = typeof value === 'string' ? textEncoder.encode(value) : await readBlob(value);
  return toHex(await crypto.subtle.digest('SHA-256', bytes));
};

const hmac = async (key: ArrayBuffer | Uint8Array, value: string): Promise<ArrayBuffer> => {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(value));
};

const encodeRfc3986 = (value: string): string =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const encodePath = (value: string): string =>
  value
    .split('/')
    .map((segment) => encodeRfc3986(segment))
    .join('/');

const normalizePrefix = (value: string): string =>
  value
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .join('/');

const getErrorBody = async (response: Response): Promise<string> => {
  const body = await response.text();
  if (!body) return `${response.status} ${response.statusText}`.trim();
  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(body, 'application/xml');
    const code = document.querySelector('Code')?.textContent?.trim();
    const message = document.querySelector('Message')?.textContent?.trim();
    if (code || message) return [code, message].filter(Boolean).join(': ');
  }
  return body.slice(0, 300);
};

const validateConfig = (config: S3StorageConfig): URL => {
  if (!config.name.trim()) throw new Error('Enter a name for this storage mount.');
  if (!config.bucket.trim()) throw new Error('Enter an object-storage bucket.');
  if (!config.region.trim()) throw new Error('Enter the signing region.');
  if (!config.accessKeyId.trim() || !config.secretAccessKey) {
    throw new Error('Enter an access key ID and secret access key.');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(config.endpoint.trim());
  } catch {
    throw new Error('Enter a valid object-storage endpoint URL.');
  }
  if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:') {
    throw new Error('Object-storage endpoints must use HTTP or HTTPS.');
  }
  if (endpoint.search || endpoint.hash) {
    throw new Error('The endpoint URL cannot contain a query string or fragment.');
  }
  return endpoint;
};

const createS3Client = (config: S3StorageConfig): ObjectStorageClient => {
  const endpoint = validateConfig(config);
  const bucket = config.bucket.trim();
  const region = config.region.trim();

  const request = async (
    method: 'GET' | 'PUT' | 'DELETE',
    key: string,
    query: Record<string, string> = {},
    body?: Blob,
  ): Promise<Response> => {
    const url = new URL(endpoint.toString());
    const endpointPath = url.pathname.replace(/\/$/, '');
    const objectPath = encodePath(key.replace(/^\/+/, ''));
    if (config.forcePathStyle) {
      url.pathname = `${endpointPath}/${encodeRfc3986(bucket)}${objectPath ? `/${objectPath}` : ''}`;
    } else {
      url.hostname = `${bucket}.${url.hostname}`;
      url.pathname = `${endpointPath}${objectPath ? `/${objectPath}` : '/'}`;
    }

    const canonicalQuery = Object.entries(query)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
      .join('&');
    url.search = canonicalQuery;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = await sha256(body ?? '');
    const signedHeaderValues: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (config.sessionToken?.trim()) {
      signedHeaderValues['x-amz-security-token'] = config.sessionToken.trim();
    }
    const signedHeaders = Object.keys(signedHeaderValues).sort().join(';');
    const canonicalHeaders = Object.keys(signedHeaderValues)
      .sort()
      .map((name) => `${name}:${signedHeaderValues[name].trim()}\n`)
      .join('');
    const canonicalRequest = [
      method,
      url.pathname,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      await sha256(canonicalRequest),
    ].join('\n');
    const dateKey = await hmac(textEncoder.encode(`AWS4${config.secretAccessKey}`), dateStamp);
    const regionKey = await hmac(dateKey, region);
    const serviceKey = await hmac(regionKey, 's3');
    const signingKey = await hmac(serviceKey, 'aws4_request');
    const signature = toHex(await hmac(signingKey, stringToSign));

    const headers = new Headers({
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId.trim()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    });
    if (config.sessionToken?.trim()) {
      headers.set('x-amz-security-token', config.sessionToken.trim());
    }

    let response: Response;
    try {
      response = await fetch(url, { method, headers, body });
    } catch (error) {
      throw new Error(
        `Could not reach the object store. Check the endpoint and bucket CORS policy. ${error instanceof Error ? error.message : ''}`.trim(),
      );
    }
    return response;
  };

  return {
    async getObject(key) {
      const response = await request('GET', key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Object read failed: ${await getErrorBody(response)}`);
      return response.blob();
    },
    async putObject(key, value) {
      const response = await request('PUT', key, {}, value);
      if (!response.ok) throw new Error(`Object write failed: ${await getErrorBody(response)}`);
    },
    async deleteObject(key) {
      const response = await request('DELETE', key);
      if (!response.ok && response.status !== 404) {
        throw new Error(`Object delete failed: ${await getErrorBody(response)}`);
      }
    },
    async listObjects(prefix) {
      const files: Array<{ key: string; size?: number; lastModified?: number }> = [];
      let continuationToken = '';
      do {
        const response = await request('GET', '', {
          'list-type': '2',
          prefix,
          ...(continuationToken ? { 'continuation-token': continuationToken } : {}),
        });
        if (!response.ok) throw new Error(`Bucket access failed: ${await getErrorBody(response)}`);
        const document = new DOMParser().parseFromString(await response.text(), 'application/xml');
        if (document.querySelector('parsererror')) {
          throw new Error('The object store returned an invalid bucket listing.');
        }
        document.querySelectorAll('Contents').forEach((item) => {
          const objectKey = item.querySelector('Key')?.textContent ?? '';
          if (!objectKey) return;
          const size = Number(item.querySelector('Size')?.textContent);
          const lastModifiedValue = Date.parse(
            item.querySelector('LastModified')?.textContent ?? '',
          );
          files.push({
            key: objectKey,
            ...(Number.isFinite(size) ? { size } : {}),
            ...(Number.isFinite(lastModifiedValue) ? { lastModified: lastModifiedValue } : {}),
          });
        });
        continuationToken =
          document.querySelector('IsTruncated')?.textContent === 'true'
            ? (document.querySelector('NextContinuationToken')?.textContent ?? '')
            : '';
      } while (continuationToken);
      return files;
    },
  };
};

export const connectS3StorageMount = async (config: S3StorageConfig): Promise<string> => {
  const client = createS3Client(config);
  const prefix = normalizePrefix(config.prefix);
  await client.listObjects?.(prefix ? `${prefix}/` : '');

  const endpoint = new URL(config.endpoint.trim());
  endpoint.pathname = endpoint.pathname.replace(/\/$/, '');
  const identity = [endpoint.toString(), config.bucket.trim(), prefix].join('\n');
  const mountId = `s3_${(await sha256(identity)).slice(0, 24)}`;
  if (activeS3Mounts.has(mountId)) {
    throw new Error('This object-storage location is already connected.');
  }
  const unregister = registerStorageMount(
    {
      id: mountId,
      name: config.name.trim(),
      kind: 'object-storage',
      resources: [...STORAGE_MOUNT_RESOURCES],
      readOnly: false,
      detail: `${config.bucket.trim()} · ${endpoint.host}${prefix ? `/${prefix}` : ''}`,
    },
    createObjectStorageAdapter(client, { prefix }),
  );
  activeS3Mounts.set(mountId, unregister);
  return mountId;
};

export const disconnectS3StorageMount = async (mountId: string): Promise<void> => {
  activeS3Mounts.get(mountId)?.();
  activeS3Mounts.delete(mountId);
  await unmountStorage(mountId);
};
