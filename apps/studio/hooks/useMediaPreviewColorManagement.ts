import { useMemo } from 'react';
import type { MediaColorManagement, ProjectColorManagement } from '@blackboard/types';
import { resolveMediaPreviewColorManagement } from '@/color-management';
import { useEditorSelector } from '@/state/editorContext';
import { useOcio } from '@/state/ocioContext';

export const useMediaPreviewColorManagement = (
  mediaColorManagement: MediaColorManagement | null,
  autoDetectDisplayView = false,
): ProjectColorManagement => {
  const projectColorManagement = useEditorSelector((state) => state.colorManagement);
  const { defaultDisplay, getViews } = useOcio();

  return useMemo(
    () =>
      resolveMediaPreviewColorManagement({
        projectColorManagement,
        mediaColorManagement,
        autoDetectDisplayView,
        defaultDisplay,
        getViews,
      }),
    [autoDetectDisplayView, defaultDisplay, getViews, mediaColorManagement, projectColorManagement],
  );
};
