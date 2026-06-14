import type { ComfyNode } from '@blackboard/types';
import { ViewportToolPanel, ViewportToolPanelHeader } from '@/components';
import { ComfyRegionInspector } from './components/ComfyRegionInspector';

function ComfyViewportToolPanel({
  node,
  onPanelClose,
}: {
  node: ComfyNode;
  activeTool: string | null;
  openPanels: ReadonlySet<string>;
  onPanelClose: (panel: string) => void;
}) {
  const workflow =
    node.workflows.find((candidate) => candidate.id === node.selectedWorkflowId) ??
    node.workflows[0] ??
    null;

  return (
    <ViewportToolPanel width="w-96">
      <ViewportToolPanelHeader title="Crop Region" onClose={() => onPanelClose('binding')} />
      <ComfyRegionInspector
        node={node}
        selectedWorkflow={workflow}
        className="max-h-[min(680px,calc(100dvh-9rem))] overflow-y-auto pr-1"
      />
    </ViewportToolPanel>
  );
}

export default ComfyViewportToolPanel;
