import { AnyNode, SceneNode } from '@blackboard/types';
import { useEditorActions } from '@/state/editorContext';
import { SettingRow } from '@/components/SettingRow';
import { OcioColorSpaceDropdown } from '@/components/OcioColorSpaceDropdown';
import { SegmentedControl } from '@/components/SegmentedControl';
import {
  CollapsibleSection,
  NumberInput,
  SplitControl,
  SplitControlAction,
  StyledDropdown,
} from '@blackboard/ui';
import * as Icons from '@blackboard/icons';
import { usePreferencesNavigation } from '@/features/projects/preferencesNavigation';

const bitDepthOptions: { value: 8 | 16 | 32; label: string }[] = [
  { value: 8, label: '8-bit' },
  { value: 16, label: '16-bit' },
  { value: 32, label: '32-bit' },
];

const fpsOptions: { value: number; label: string }[] = [
  { value: 23.976, label: '23.976 fps' },
  { value: 24, label: '24 fps' },
  { value: 25, label: '25 fps' },
  { value: 30, label: '30 fps' },
  { value: 60, label: '60 fps' },
];

function SceneAdjustments({ node: anyNode }: { node: AnyNode }) {
  const sceneNode = anyNode as SceneNode;
  const { updateNode, setMaxFrames } = useEditorActions();
  const { openPreferences } = usePreferencesNavigation();

  const handleUpdate = (updates: Partial<SceneNode>) => {
    updateNode(sceneNode.id, updates, true);
  };

  return (
    <div>
      <CollapsibleSection title="Composition" defaultOpen>
        <div>
          <SettingRow label="Resolution">
            <div className="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
              <NumberInput
                value={sceneNode.width}
                onValueChange={(width) => handleUpdate({ width })}
                normalizeValue={Math.round}
                min="1"
                step="1"
                aria-label="Resolution width"
              />
              <span aria-hidden="true" className="text-[10px] font-medium text-gray-600">
                ×
              </span>
              <NumberInput
                value={sceneNode.height}
                onValueChange={(height) => handleUpdate({ height })}
                normalizeValue={Math.round}
                min="1"
                step="1"
                aria-label="Resolution height"
              />
            </div>
          </SettingRow>

          <SettingRow label="Timeline Duration">
            <NumberInput
              value={sceneNode.maxFrames}
              onValueChange={(maxFrames) => setMaxFrames(maxFrames)}
              normalizeValue={Math.round}
              min="0"
              step="1"
              aria-label="Timeline duration in frames"
            />
          </SettingRow>

          <SettingRow label="Frame Rate">
            <StyledDropdown
              value={sceneNode.fps || 30}
              options={fpsOptions}
              onChange={(value) => handleUpdate({ fps: value as number })}
              widthClass="w-full"
              popoverWidthClass="w-48"
            />
          </SettingRow>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Color Pipeline" defaultOpen>
        <div>
          <SettingRow label="Working Space">
            <SplitControl className="w-full">
              <div className="min-w-0 flex-1 overflow-hidden">
                <OcioColorSpaceDropdown
                  value={sceneNode.colorSpace}
                  onChange={(value) =>
                    handleUpdate({ colorSpace: value as SceneNode['colorSpace'] })
                  }
                  includeData={false}
                  widthClass="w-full"
                  popoverWidthClass="w-80"
                />
              </div>
              <SplitControlAction
                onClick={() =>
                  openPreferences({
                    section: 'colorManagement',
                    colorScope: 'project',
                  })
                }
                title="Open project color settings"
                aria-label="Open project color settings"
              >
                <Icons.Cog className="h-4 w-4" />
              </SplitControlAction>
            </SplitControl>
          </SettingRow>

          <SettingRow label="Bit Depth">
            <SegmentedControl
              value={sceneNode.bitDepth}
              options={bitDepthOptions}
              onChange={(value) => handleUpdate({ bitDepth: Number(value) as 8 | 16 | 32 })}
              className="w-full"
            />
          </SettingRow>
        </div>
      </CollapsibleSection>
    </div>
  );
}

export default SceneAdjustments;
