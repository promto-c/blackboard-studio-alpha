import type { AnyNode, OcioColorSpaceName, DisplayViewSelection } from '@blackboard/types';
import type { DisplayViewInfo } from './types';

/**
 * View name used for Rec.709 / sRGB consumer SDR input sources.
 * This view applies a colorimetric video transform that preserves the
 * input's original appearance without gamut compression or artistic
 * grading.
 */
const VIDEO_COLORIMETRIC_VIEW = 'Video (colorimetric)';

/**
 * Set of color-space names that identify standard consumer SDR content
 * (Rec.709 / sRGB encoded).  Matches both the canonical OCIO name and
 * common aliases.
 */
const SDR_CONSUMER_COLOR_SPACES: ReadonlySet<string> = new Set([
  'sRGB Encoded Rec.709 (sRGB)',
  'sRGB',
  'Rec.709',
  'BT.709',
  'Bt709',
]);

/** Result of auto-detection — null means "fall back to preference". */
export type AutoDetectViewResult = DisplayViewSelection | null;

/**
 * Convenience type alias for a look-up function that returns available
 * view info for a given display.
 */
type GetViews = (display: string) => readonly DisplayViewInfo[];

/**
 * Checks whether the given color-space name is an SDR consumer color
 * space (Rec.709 / sRGB encoded).
 */
const isSdrConsumerColorSpace = (colorSpace: OcioColorSpaceName): boolean =>
  SDR_CONSUMER_COLOR_SPACES.has(colorSpace);

/**
 * Finds the first media-source node in the ordered node list whose
 * color space can be read.  Returns the node's resolved source
 * color-space, or null when no suitable source is found.
 *
 * Instead of importing from the node registry (which could introduce
 * circular dependencies), this function identifies source nodes by
 * checking for the presence of source-specific properties
 * (`mediaColorManagement`, `src`, or `frames`) while explicitly
 * skipping scene-like nodes (which carry `width`/`height` but not
 * `src`/`frames`).
 */
const getFirstSourceColorSpace = (nodes: readonly AnyNode[]): OcioColorSpaceName | null => {
  for (const node of nodes) {
    if (node.enabled === false) continue;

    // Skip detached nodes
    if ((node as { detachedFromPipe?: boolean }).detachedFromPipe) continue;

    // Skip scene-like nodes (Scene, 3D Scene) — they have a
    // production-oriented colorSpace but are not "inputs."
    if (
      (node as { width?: unknown; height?: unknown }).width !== undefined &&
      (node as { src?: unknown }).src === undefined &&
      (node as { frames?: unknown }).frames === undefined
    ) {
      continue;
    }

    // Prefer the resolved mediaColorManagement.sourceColorSpace
    if ('mediaColorManagement' in node && node.mediaColorManagement) {
      const mediaColorMgmt = (
        node as AnyNode & { mediaColorManagement: { sourceColorSpace?: OcioColorSpaceName } }
      ).mediaColorManagement;
      const sourceColorSpace = mediaColorMgmt.sourceColorSpace?.trim() ?? null;
      if (sourceColorSpace) return sourceColorSpace;
    }

    // Fall back to the bare colorSpace field
    if (
      'colorSpace' in node &&
      typeof (node as { colorSpace?: OcioColorSpaceName }).colorSpace === 'string'
    ) {
      const colorSpace = (node as { colorSpace?: OcioColorSpaceName }).colorSpace;
      if (colorSpace) return colorSpace;
    }
  }
  return null;
};

/**
 * Compute the recommended viewport display/view based on the first input
 * source's color space.
 *
 * Rules:
 * - Rec.709 / sRGB consumer SDR content → `Video (colorimetric)` view
 *   (if available in the active OCIO config).
 * - Anything else → `null` (fall back to the user's manual preference).
 *
 * @param nodes         Current project node list (ordered).
 * @param defaultDisplay The default display name (e.g. `sRGB - Display`).
 * @param getViews       Function that returns available views for a display.
 * @returns A `DisplayViewSelection` when auto-detection succeeds, or `null`
 *          when the input should fall back to the configured default.
 */
export function getAutoDetectedView(
  nodes: readonly AnyNode[],
  defaultDisplay: string,
  getViews: GetViews,
): AutoDetectViewResult {
  const colorSpace = getFirstSourceColorSpace(nodes);
  if (!colorSpace) return null;

  if (!isSdrConsumerColorSpace(colorSpace)) return null;

  const displayViews = getViews(defaultDisplay);
  const hasVideoColorimetric = displayViews.some((view) => view.name === VIDEO_COLORIMETRIC_VIEW);
  if (!hasVideoColorimetric) return null;

  return { display: defaultDisplay, view: VIDEO_COLORIMETRIC_VIEW };
}
