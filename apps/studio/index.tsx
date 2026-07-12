import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { StudioHotkeysProvider } from '@/hotkeys';
import { initTheme } from '@/state/preferences';
import { PreferencesProvider } from './state/preferencesContext';
import { DebugLogProvider } from './utils/debugLogContext';
import { EditorProvider } from './state/editorContext';
import { ProjectOcioProvider } from './state/ocioContext';
import { InstalledOnnxModelsProvider } from './state/installedOnnxModelsContext';
import { initComponentSurfaceLighting } from '@/utils/componentSurfaceLighting';
import { EditorUIInteractionProvider } from '@/components/EditorUIInteractionProvider';

// Initialize theme before React renders to avoid a flash of unstyled content
initTheme();
initComponentSurfaceLighting();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <DebugLogProvider>
      <PreferencesProvider>
        <InstalledOnnxModelsProvider>
          <EditorProvider>
            <EditorUIInteractionProvider>
              <ProjectOcioProvider>
                <StudioHotkeysProvider>
                  <App />
                </StudioHotkeysProvider>
              </ProjectOcioProvider>
            </EditorUIInteractionProvider>
          </EditorProvider>
        </InstalledOnnxModelsProvider>
      </PreferencesProvider>
    </DebugLogProvider>
  </React.StrictMode>,
);
