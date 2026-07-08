import { useEffect, useState } from 'react';
import type { ColorConfigReference } from '@blackboard/types';
import {
  colorManagementService,
  normalizeBuiltinConfigName,
  type ColorManagementRuntimeSnapshot,
} from '@/color-management';

interface OcioConfigSnapshotResult {
  snapshot: ColorManagementRuntimeSnapshot | null;
  isLoading: boolean;
  error: string | null;
}

const getConfigName = (reference: ColorConfigReference): string =>
  reference.kind === 'builtin' ? normalizeBuiltinConfigName(reference.uri) : reference.uri;

export function useOcioConfigSnapshot(reference: ColorConfigReference): OcioConfigSnapshotResult {
  const referenceKind = reference.kind;
  const referenceUri = reference.uri;
  const referenceId = reference.kind === 'builtin' ? reference.id : '';
  const configName = getConfigName(reference);
  const [result, setResult] = useState<ColorManagementRuntimeSnapshot | null>(() => {
    const activeSnapshot = colorManagementService.getSnapshot();
    return activeSnapshot.configName === configName ? activeSnapshot : null;
  });

  useEffect(() => {
    let cancelled = false;
    const normalizedReference: ColorConfigReference =
      referenceKind === 'builtin'
        ? {
            kind: 'builtin',
            id: referenceId,
            uri: normalizeBuiltinConfigName(referenceUri),
          }
        : {
            kind: 'external',
            uri: referenceUri,
          };
    setResult(null);

    void colorManagementService.inspectConfig(normalizedReference).then((snapshot) => {
      if (cancelled) return;
      setResult(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, [configName, referenceId, referenceKind, referenceUri]);

  const matchedResult = result?.configName === configName ? result : null;
  return {
    snapshot: matchedResult?.isInitialized && !matchedResult.error ? matchedResult : null,
    isLoading: !matchedResult || matchedResult.isLoading,
    error: matchedResult?.error ?? null,
  };
}
