import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { InstalledOnnxModel } from '@blackboard/types';
import { getInstalledOnnxModels } from '@/services/onnx/modelCache';
import { primeMetadataFromModel } from '@/services/onnx/onnxMetadataCache';

interface InstalledOnnxModelsContextType {
  models: InstalledOnnxModel[];
  refresh: () => Promise<void>;
}

const InstalledOnnxModelsContext = createContext<InstalledOnnxModelsContextType | undefined>(
  undefined,
);

export const useInstalledOnnxModels = (): InstalledOnnxModelsContextType => {
  const context = useContext(InstalledOnnxModelsContext);
  if (!context) {
    throw new Error('useInstalledOnnxModels must be used within an InstalledOnnxModelsProvider');
  }
  return context;
};

export const InstalledOnnxModelsProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [models, setModels] = useState<InstalledOnnxModel[]>([]);
  const mountedRef = useRef(false);

  const refresh = useCallback(async () => {
    const loaded = await getInstalledOnnxModels();
    for (const model of loaded) {
      primeMetadataFromModel(model);
    }
    setModels(loaded);
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void refresh();
  }, [refresh]);

  return (
    <InstalledOnnxModelsContext.Provider value={{ models, refresh }}>
      {children}
    </InstalledOnnxModelsContext.Provider>
  );
};
