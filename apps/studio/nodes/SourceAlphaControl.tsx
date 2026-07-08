import type { AnyNode, SourceAlphaMode } from '@blackboard/types';
import { SegmentedControl } from '@/components';
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
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-400">Alpha</label>
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
      />
    </div>
  );
}

export default SourceAlphaControl;
