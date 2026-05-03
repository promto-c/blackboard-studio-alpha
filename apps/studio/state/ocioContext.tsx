import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { ocioManager } from '@/utils/ocio';

interface OcioState {
  isInitialized: boolean;
  views: string[];
  createProcessor: (from: string, to: string) => number;
  getGpuShader: (handle: number) => { header: string; uniforms: string; main: string };
}

const OcioContext = createContext<OcioState | undefined>(undefined);

export const OcioProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    const initialize = async () => {
      await ocioManager.initialize();
      setIsInitialized(ocioManager.getIsInitialized());
    };
    initialize();
  }, []);

  const value: OcioState = {
    isInitialized,
    views: ocioManager.getViews(),
    createProcessor: ocioManager.createProcessor.bind(ocioManager),
    getGpuShader: ocioManager.getGpuShader.bind(ocioManager),
  };

  return <OcioContext.Provider value={value}>{children}</OcioContext.Provider>;
};

export const useOcio = () => {
  const context = useContext(OcioContext);
  if (!context) {
    throw new Error('useOcio must be used within an OcioProvider');
  }
  return context;
};
