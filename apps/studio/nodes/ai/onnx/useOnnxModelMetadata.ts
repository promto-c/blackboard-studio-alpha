import { useCallback, useEffect, useState } from 'react';
import type {
  InstalledOnnxModel,
  OnnxBackend,
  OnnxInputMetadata,
  OnnxOutputMetadata,
} from '@blackboard/types';
import { updateInstalledOnnxModel } from '@/services/onnx/modelCache';
import {
  getCachedOnnxModelInputMetadata,
  getCachedOnnxModelOutputMetadata,
  loadOnnxModelIoMetadataCached,
} from '@/services/onnx/onnxMetadataCache';
import { getErrorMessage } from '@/utils/guards';

export const useOnnxModelMetadata = (
  selectedModel: InstalledOnnxModel | null,
  backend: OnnxBackend,
): {
  inputMetadata: OnnxInputMetadata[] | null;
  outputMetadata: OnnxOutputMetadata[] | null;
  isLoadingMetadata: boolean;
  metadataError: string | null;
  retryMetadata: () => void;
} => {
  const [inputMetadata, setInputMetadata] = useState<OnnxInputMetadata[] | null>(null);
  const [outputMetadata, setOutputMetadata] = useState<OnnxOutputMetadata[] | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!selectedModel) {
      setInputMetadata(null);
      setOutputMetadata(null);
      setMetadataError(null);
      setIsLoadingMetadata(false);
      return () => {
        cancelled = true;
      };
    }

    const persistedInputs = getCachedOnnxModelInputMetadata(selectedModel);
    const persistedOutputs = getCachedOnnxModelOutputMetadata(selectedModel);
    if (persistedInputs) {
      setInputMetadata(persistedInputs);
      setOutputMetadata(persistedOutputs);
      setIsLoadingMetadata(false);
      setMetadataError(null);
      return () => {
        cancelled = true;
      };
    }

    setIsLoadingMetadata(true);
    setMetadataError(null);

    loadOnnxModelIoMetadataCached(selectedModel, backend)
      .then((metadata) => {
        if (cancelled) return;
        setInputMetadata(metadata.inputs);
        setOutputMetadata(metadata.outputs);
        setIsLoadingMetadata(false);
      })
      .catch((caught) => {
        if (cancelled) return;
        setMetadataError(getErrorMessage(caught, 'Failed to load model metadata'));
        setIsLoadingMetadata(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backend, reloadToken, selectedModel]);

  const retryMetadata = useCallback(() => {
    if (!selectedModel) return;

    if (selectedModel.variant.metadataError) {
      void updateInstalledOnnxModel({
        ...selectedModel,
        variant: {
          ...selectedModel.variant,
          metadataError: undefined,
        },
      }).catch(() => {});
    }

    setMetadataError(null);
    setReloadToken((current) => current + 1);
  }, [selectedModel]);

  return {
    inputMetadata,
    outputMetadata,
    isLoadingMetadata,
    metadataError,
    retryMetadata,
  };
};
