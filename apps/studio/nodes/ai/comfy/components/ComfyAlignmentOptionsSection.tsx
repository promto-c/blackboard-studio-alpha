import type { ComfyNode } from '@blackboard/types';
import { CheckboxIndicator, SegmentedControl } from '@/components';
import { useEditorActions } from '@/state/editorContext';
import {
  COMFY_ALIGNMENT_QUALITY_PRESETS,
  getComfyAlignmentQuality,
  resolveComfyAlignmentOptions,
  type ComfyAlignmentOptions,
  type ComfyAlignmentQuality,
} from '../comfyAlignmentOptions';

interface ComfyAlignmentOptionsSectionProps {
  node: ComfyNode;
}

interface AlignmentOptionProps {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function AlignmentOption({ checked, description, label, onChange }: AlignmentOptionProps) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-400">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <CheckboxIndicator checked={checked} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-gray-300">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-gray-500">{description}</span>
      </span>
    </label>
  );
}

export function ComfyAlignmentOptionsSection({ node }: ComfyAlignmentOptionsSectionProps) {
  const { updateNode } = useEditorActions();

  const currentOptions = resolveComfyAlignmentOptions(node.alignmentOptions);
  const currentQuality = getComfyAlignmentQuality(node.alignmentOptions);

  const setOptions = (alignmentOptions: Required<ComfyAlignmentOptions>) => {
    updateNode(node.id, { alignmentOptions }, true);
  };

  const setQuality = (quality: ComfyAlignmentQuality) => {
    setOptions({ ...COMFY_ALIGNMENT_QUALITY_PRESETS[quality] });
  };

  const setOption = (key: keyof ComfyAlignmentOptions, value: boolean) => {
    setOptions({ ...currentOptions, [key]: value });
  };

  return (
    <div className="max-h-[min(70vh,32rem)] overflow-y-auto p-1">
      <div className="text-xs font-medium text-gray-200">Alignment quality</div>
      <div className="mt-2">
        <SegmentedControl
          ariaLabel="Alignment quality"
          options={[
            { value: 'fast', label: 'Fast', title: 'Single-pass alignment' },
            {
              value: 'balanced',
              label: 'Balanced',
              title: 'Improved matching without the high-resolution pass',
            },
            { value: 'precise', label: 'Precise', title: 'Enable every refinement' },
          ]}
          value={currentQuality ?? ''}
          onChange={(value) => setQuality(value as ComfyAlignmentQuality)}
        />
      </div>

      <div className="my-3 h-px bg-white/10" />
      <div className="mb-2 text-xs font-medium text-gray-200">Alignment Refinements</div>
      <div className="space-y-2">
        <AlignmentOption
          checked={currentOptions.skipEditedRegions}
          label="Skip edited regions"
          description="Avoid tracking points in areas where the AI significantly changed the image (img2img)."
          onChange={(checked) => setOption('skipEditedRegions', checked)}
        />
        <AlignmentOption
          checked={currentOptions.iterativeRefinement}
          label="Iterative refinement"
          description="Re-track selected points with progressively smaller search radii for higher precision."
          onChange={(checked) => setOption('iterativeRefinement', checked)}
        />
        <AlignmentOption
          checked={currentOptions.highResRefinement}
          label="High-resolution refinement"
          description="Run a second alignment pass at 2× resolution for sub-pixel accuracy."
          onChange={(checked) => setOption('highResRefinement', checked)}
        />
        <AlignmentOption
          checked={currentOptions.edgeAwareSampling}
          label="Edge-aware sampling"
          description="Prioritize strong edges and discard uniform areas where optical flow is unreliable."
          onChange={(checked) => setOption('edgeAwareSampling', checked)}
        />
        <AlignmentOption
          checked={currentOptions.subPixelRefinement}
          label="Sub-pixel NCC refinement"
          description="Refine tracked positions to sub-pixel accuracy using interpolation of NCC scores."
          onChange={(checked) => setOption('subPixelRefinement', checked)}
        />
      </div>
    </div>
  );
}
