import type { AnyNode, SourceAlphaMode } from '@blackboard/types';
import { SegmentedControl, SettingRow } from '@/components';
import { useEditorActions } from '@/state/editorContext';

const SOURCE_ALPHA_OPTIONS: Array<{ value: SourceAlphaMode; label: string }> = [
  { value: 'file', label: 'From file' },
  { value: 'opaque', label: 'Opaque' },
  { value: 'transparent', label: 'Transparent' },
];

function SourceAlphaControl({ node }: { node: AnyNode }) {
  const { updateNode } = useEditorActions();
  const sourceAlphaMode = (node as { sourceAlphaMode?: SourceAlphaMode }).sourceAlphaMode ?? 'file';

  return (
    <SettingRow label="Alpha">
      <SegmentedControl
        value={sourceAlphaMode}
        options={SOURCE_ALPHA_OPTIONS}
        onChange={(value) =>
          updateNode(
            node.id,
            { sourceAlphaMode: value as SourceAlphaMode } as Partial<AnyNode>,
            true,
          )
        }
        className="w-full"
      />
    </SettingRow>
  );
}

export default SourceAlphaControl;
