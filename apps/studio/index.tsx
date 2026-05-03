import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { StudioHotkeysProvider } from '@/hotkeys';
import { PreferencesProvider, initTheme } from './state/preferencesContext';
import { EditorProvider } from './state/editorContext';
import { OcioProvider } from './state/ocioContext';

// Initialize theme before React renders to avoid a flash of unstyled content
initTheme();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <PreferencesProvider>
      <OcioProvider>
        <EditorProvider>
          <StudioHotkeysProvider>
            <App />
          </StudioHotkeysProvider>
        </EditorProvider>
      </OcioProvider>
    </PreferencesProvider>
  </React.StrictMode>,
);
