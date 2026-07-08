import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExternalColorConfigReference } from '@blackboard/types';

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: tauriMocks.invoke,
  isTauri: tauriMocks.isTauri,
}));

import {
  loadExternalOcioConfigPackage,
  registerExternalOcioConfigPackage,
  removeExternalOcioConfigPackage,
} from './externalConfig';

const reference: ExternalColorConfigReference = {
  kind: 'external',
  uri: 'project:///show/config.ocio',
};

afterEach(() => {
  removeExternalOcioConfigPackage(reference.uri);
  tauriMocks.invoke.mockReset();
  tauriMocks.isTauri.mockReturnValue(false);
});

describe('external OCIO config packages', () => {
  it('normalizes and returns a session-located package', async () => {
    registerExternalOcioConfigPackage(reference, {
      configPath: reference.uri,
      configRelativePath: 'show\\config.ocio',
      files: [
        {
          relativePath: 'show\\config.ocio',
          data: new Uint8Array([1, 2, 3]),
        },
      ],
    });

    await expect(loadExternalOcioConfigPackage(reference)).resolves.toMatchObject({
      configRelativePath: 'show/config.ocio',
      files: [{ relativePath: 'show/config.ocio' }],
    });
  });

  it('rejects package paths that escape the selected directory', () => {
    expect(() =>
      registerExternalOcioConfigPackage(reference, {
        configPath: reference.uri,
        configRelativePath: '../config.ocio',
        files: [{ relativePath: '../config.ocio', data: new Uint8Array() }],
      }),
    ).toThrow('Invalid external OCIO package path');
  });

  it('fails explicitly when a project-relative package has not been located', async () => {
    await expect(loadExternalOcioConfigPackage(reference)).rejects.toThrow(
      'is not available in this session',
    );
  });

  it('loads a local config package through the Tauri command boundary', async () => {
    const nativeReference: ExternalColorConfigReference = {
      kind: 'external',
      uri: 'file:///show/config.ocio',
    };
    tauriMocks.isTauri.mockReturnValue(true);
    tauriMocks.invoke.mockResolvedValue({
      configPath: '/show/config.ocio',
      configRelativePath: 'config.ocio',
      files: [{ relativePath: 'config.ocio', data: [1, 2, 3] }],
    });

    await expect(loadExternalOcioConfigPackage(nativeReference)).resolves.toEqual({
      configPath: '/show/config.ocio',
      configRelativePath: 'config.ocio',
      files: [{ relativePath: 'config.ocio', data: new Uint8Array([1, 2, 3]) }],
    });
    expect(tauriMocks.invoke).toHaveBeenCalledWith('read_ocio_config_package', {
      configPath: '/show/config.ocio',
    });
  });
});
