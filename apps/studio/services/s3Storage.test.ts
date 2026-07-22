// @vitest-environment jsdom

import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeStorageFile } from '@blackboard/project-store';
import { connectS3StorageMount, disconnectS3StorageMount, type S3StorageConfig } from './s3Storage';

const CONFIG: S3StorageConfig = {
  name: 'Team store',
  endpoint: 'https://objects.example.com',
  region: 'auto',
  bucket: 'studio-bucket',
  prefix: '/team/studio/',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
  sessionToken: 'temporary-token',
  forcePathStyle: true,
};

const EMPTY_LIST_RESULT = `<?xml version="1.0" encoding="UTF-8"?>
  <ListBucketResult>
    <IsTruncated>false</IsTruncated>
  </ListBucketResult>`;

describe('S3 object-storage mounts', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', webcrypto);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tests the bucket, signs requests, and routes mounted writes through the configured prefix', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(EMPTY_LIST_RESULT, {
          status: 200,
          headers: { 'Content-Type': 'application/xml' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const mountId = await connectS3StorageMount(CONFIG);
    await writeStorageFile(mountId, 'workspace/notes.txt', 'hello');

    const listRequest = fetchMock.mock.calls[0];
    const listUrl = new URL(String(listRequest[0]));
    expect(listUrl.pathname).toBe('/studio-bucket');
    expect(listUrl.searchParams.get('list-type')).toBe('2');
    expect(listUrl.searchParams.get('prefix')).toBe('team/studio/');

    const writeRequest = fetchMock.mock.calls[1];
    expect(new URL(String(writeRequest[0])).pathname).toBe(
      '/studio-bucket/team/studio/workspace/notes.txt',
    );
    const headers = writeRequest[1]?.headers as Headers;
    expect(headers.get('authorization')).toContain('Credential=access-key/');
    expect(headers.get('x-amz-security-token')).toBe('temporary-token');
    expect(writeRequest[1]?.method).toBe('PUT');

    await disconnectS3StorageMount(mountId);
  });

  it('surfaces provider errors before registering a mount', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          '<Error><Code>AccessDenied</Code><Message>Invalid credentials</Message></Error>',
          {
            status: 403,
            headers: { 'Content-Type': 'application/xml' },
          },
        ),
      ),
    );

    await expect(connectS3StorageMount(CONFIG)).rejects.toThrow(
      'Bucket access failed: AccessDenied: Invalid credentials',
    );
  });

  it('rejects endpoints with embedded query parameters', async () => {
    await expect(
      connectS3StorageMount({ ...CONFIG, endpoint: 'https://objects.example.com?token=secret' }),
    ).rejects.toThrow('endpoint URL cannot contain a query string');
  });
});
