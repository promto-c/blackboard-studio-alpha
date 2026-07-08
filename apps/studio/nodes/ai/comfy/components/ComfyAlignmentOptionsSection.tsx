import type { ComfyNode } from '@blackboard/types';
import { useEditorActions } from '@/state/editorContext';

interface ComfyAlignmentOptionsSectionProps {
  node: ComfyNode;
}

export function ComfyAlignmentOptionsSection({ node }: ComfyAlignmentOptionsSectionProps) {
  const { updateNode } = useEditorActions();

  const currentOptions = node.alignmentOptions ?? {};
  const skipEditedRegions = currentOptions.skipEditedRegions !== false;
  const iterativeRefinement = currentOptions.iterativeRefinement !== false;
  const highResRefinement = currentOptions.highResRefinement !== false;
  const edgeAwareSampling = currentOptions.edgeAwareSampling !== false;
  const subPixelRefinement = currentOptions.subPixelRefinement !== false;

  const setOption = (
    key:
      | 'skipEditedRegions'
      | 'iterativeRefinement'
      | 'highResRefinement'
      | 'edgeAwareSampling'
      | 'subPixelRefinement',
    value: boolean,
  ) => {
    updateNode(
      node.id,
      {
        alignmentOptions: {
          ...currentOptions,
          [key]: value,
        },
      },
      true,
    );
  };

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
      <div className="mb-2 text-xs font-medium text-gray-300">Alignment refinements</div>
      <div className="space-y-2">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={skipEditedRegions}
            onChange={(event) => setOption('skipEditedRegions', event.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-primary-500"
          />
          <div className="min-w-0">
            <div className="text-gray-300">Skip edited regions</div>
            <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
              Avoid tracking points in areas where the AI significantly changed the image (img2img).
            </div>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={iterativeRefinement}
            onChange={(event) => setOption('iterativeRefinement', event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-primary-500"
          />
          <div className="min-w-0">
            <div className="text-gray-300">Iterative refinement</div>
            <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
              Re-track selected points with progressively smaller search radii for higher precision.
            </div>
          </div>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={highResRefinement}
            onChange={(event) => setOption('highResRefinement', event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-primary-500"
          />
          <div className="min-w-0">
            <div className="text-gray-300">High-resolution refinement</div>
            <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
              Run a second alignment pass at 2× resolution for sub-pixel accuracy.
            </div>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={edgeAwareSampling}
            onChange={(event) => setOption('edgeAwareSampling', event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-primary-500"
          />
          <div className="min-w-0">
            <div className="text-gray-300">Edge-aware sampling</div>
            <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
              Prioritize tracking points on strong edges and discard points in uniform areas where
              optical flow is unreliable.
            </div>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-400">
          <input
            type="checkbox"
            checked={subPixelRefinement}
            onChange={(event) => setOption('subPixelRefinement', event.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-primary-500"
          />
          <div className="min-w-0">
            <div className="text-gray-300">Sub-pixel NCC refinement</div>
            <div className="mt-0.5 text-[11px] leading-4 text-gray-500">
              After RANSAC fitting, refine tracked positions to sub-pixel accuracy via parabolic
              interpolation of NCC scores.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
