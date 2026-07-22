import React from 'react';
import * as Icons from '@blackboard/icons';
import { TextInput } from '@blackboard/ui';
import { SegmentedControl } from '@/components';
import { getErrorMessage } from '@/utils/guards';
import { connectS3StorageMount, type S3StorageConfig } from '@/services/s3Storage';

const INITIAL_CONFIG: S3StorageConfig = {
  name: '',
  endpoint: 'https://s3.amazonaws.com',
  region: 'us-east-1',
  bucket: '',
  prefix: 'blackboard-studio',
  accessKeyId: '',
  secretAccessKey: '',
  sessionToken: '',
  forcePathStyle: true,
};

const FIELD_CLASS = 'w-full';

export default function S3StorageMountDialog({
  isOpen,
  onClose,
  onConnected,
}: {
  isOpen: boolean;
  onClose: () => void;
  onConnected: (mountId: string) => void;
}) {
  const [config, setConfig] = React.useState(INITIAL_CONFIG);
  const [isConnecting, setIsConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setConfig(INITIAL_CONFIG);
    setError(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const update = <Key extends keyof S3StorageConfig>(key: Key, value: S3StorageConfig[Key]) =>
    setConfig((current) => ({ ...current, [key]: value }));

  const connect = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsConnecting(true);
    setError(null);
    try {
      const mountId = await connectS3StorageMount(config);
      onConnected(mountId);
      onClose();
    } catch (connectionError) {
      setError(getErrorMessage(connectionError, 'Could not connect to object storage.'));
    } finally {
      setIsConnecting(false);
    }
  };

  const field = (
    id: string,
    label: string,
    value: string,
    onValueChange: (value: string) => void,
    options: { placeholder?: string; type?: string; autoComplete?: string } = {},
  ) => (
    <label htmlFor={id} className="space-y-1.5">
      <span className="block text-xs font-medium text-gray-300">{label}</span>
      <TextInput
        id={id}
        value={value}
        onValueChange={onValueChange}
        className={FIELD_CLASS}
        disabled={isConnecting}
        {...options}
      />
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="s3-storage-title"
      onClick={isConnecting ? undefined : onClose}
    >
      <form
        className="glass-component max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-gray-900/90 p-5 shadow-2xl ring-1 ring-inset ring-white/10"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void connect(event)}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 id="s3-storage-title" className="text-lg font-semibold text-white">
              Connect object storage
            </h2>
            <p className="mt-1 text-sm leading-5 text-gray-400">
              Connect Amazon S3, MinIO, Cloudflare R2, Backblaze B2, or another SigV4-compatible
              service.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isConnecting}
            className="rounded-full p-1 text-gray-400 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
            aria-label="Close object storage dialog"
          >
            <Icons.XMark className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {field('s3-name', 'Display name', config.name, (value) => update('name', value), {
            placeholder: 'Team storage',
          })}
          {field('s3-bucket', 'Bucket', config.bucket, (value) => update('bucket', value), {
            placeholder: 'studio-projects',
          })}
          <div className="sm:col-span-2">
            {field(
              's3-endpoint',
              'Endpoint URL',
              config.endpoint,
              (value) => update('endpoint', value),
              {
                placeholder: 'https://s3.example.com',
                type: 'url',
              },
            )}
          </div>
          {field('s3-region', 'Signing region', config.region, (value) => update('region', value), {
            placeholder: 'us-east-1',
          })}
          {field('s3-prefix', 'Root prefix', config.prefix, (value) => update('prefix', value), {
            placeholder: 'blackboard-studio',
          })}
          {field(
            's3-access-key',
            'Access key ID',
            config.accessKeyId,
            (value) => update('accessKeyId', value),
            {
              autoComplete: 'off',
            },
          )}
          {field(
            's3-secret-key',
            'Secret access key',
            config.secretAccessKey,
            (value) => update('secretAccessKey', value),
            {
              type: 'password',
              autoComplete: 'new-password',
            },
          )}
          <div className="sm:col-span-2">
            {field(
              's3-session-token',
              'Session token (optional)',
              config.sessionToken ?? '',
              (value) => update('sessionToken', value),
              {
                type: 'password',
                autoComplete: 'off',
              },
            )}
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-200">Bucket addressing</p>
              <p className="mt-0.5 text-[11px] leading-4 text-gray-500">
                Path-style is recommended for compatible providers and local gateways.
              </p>
            </div>
            <SegmentedControl
              ariaLabel="Bucket addressing style"
              value={config.forcePathStyle ? 'path' : 'virtual-hosted'}
              options={[
                {
                  value: 'path',
                  label: 'Path-style',
                  ariaLabel: 'Use path-style bucket URLs',
                  disabled: isConnecting,
                },
                {
                  value: 'virtual-hosted',
                  label: 'Virtual-hosted',
                  ariaLabel: 'Use virtual-hosted bucket URLs',
                  disabled: isConnecting,
                },
              ]}
              onChange={(value) => update('forcePathStyle', value === 'path')}
              className="w-full shrink-0 sm:w-64"
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-amber-400/15 bg-amber-400/[0.045] px-3 py-2 text-[11px] leading-5 text-amber-100/70">
          Credentials stay in memory for this app session and are never written to project data.
          Your bucket must allow this app origin through CORS for GET, PUT, DELETE, and listing.
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-red-400/20 bg-red-400/[0.055] px-3 py-2 text-xs leading-5 text-red-200">
            {error}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-xs text-gray-300 transition hover:bg-white/5"
            onClick={onClose}
            disabled={isConnecting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-lg border border-primary-400/30 bg-primary-500/15 px-4 py-2 text-xs font-medium text-primary-100 transition hover:bg-primary-500/25 disabled:cursor-wait disabled:opacity-50"
            disabled={isConnecting}
          >
            {isConnecting ? 'Testing connection…' : 'Connect storage'}
          </button>
        </div>
      </form>
    </div>
  );
}
