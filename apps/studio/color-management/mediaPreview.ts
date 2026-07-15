import type { MediaColorManagement, ProjectColorManagement } from '@blackboard/types';
import { getAutoDetectedViewForColorSpace, type GetOcioViews } from './autoDetectView';
import { getMediaSourceColorSpace } from './media';

export interface ResolveMediaPreviewColorManagementOptions {
  projectColorManagement: ProjectColorManagement;
  mediaColorManagement: MediaColorManagement | null;
  autoDetectDisplayView: boolean;
  defaultDisplay: string;
  getViews: GetOcioViews;
}

/**
 * Resolve the color configuration for an isolated media preview. The preview
 * keeps the project's config, working space, roles, and context, while using
 * the same source-aware display/view rule as the main viewport when enabled.
 */
export const resolveMediaPreviewColorManagement = ({
  projectColorManagement,
  mediaColorManagement,
  autoDetectDisplayView,
  defaultDisplay,
  getViews,
}: ResolveMediaPreviewColorManagementOptions): ProjectColorManagement => {
  if (!autoDetectDisplayView || !mediaColorManagement) return projectColorManagement;

  const detectedView = getAutoDetectedViewForColorSpace(
    getMediaSourceColorSpace(mediaColorManagement),
    defaultDisplay,
    getViews,
  );
  if (!detectedView) return projectColorManagement;

  const currentView = projectColorManagement.viewer;
  if (
    currentView.display === detectedView.display &&
    currentView.view === detectedView.view &&
    currentView.look === detectedView.look
  ) {
    return projectColorManagement;
  }

  return {
    ...projectColorManagement,
    viewer: detectedView,
  };
};
