import type { ReactNode } from 'react';
import { UIInteractionProvider } from '@blackboard/ui';
import { useEditorActions } from '@/state/editorContext';

export function EditorUIInteractionProvider({ children }: { children: ReactNode }) {
  const { beginHistoryInteraction, endHistoryInteraction } = useEditorActions();

  return (
    <UIInteractionProvider
      beginInteraction={beginHistoryInteraction}
      endInteraction={endHistoryInteraction}
    >
      {children}
    </UIInteractionProvider>
  );
}
