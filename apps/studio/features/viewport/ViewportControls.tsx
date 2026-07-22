import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { ViewportZoom } from '@/utils/viewportZoom';
import { CanvasViewportControls } from '@/components/CanvasViewportControls';

interface ViewportControlsProps {
  visible: boolean;
  onFit: () => void;
  zoomValue: number;
}

function ViewportControls({ visible, onFit, zoomValue }: ViewportControlsProps) {
  const targetZoom = useEditorSelector((s) => s.targetZoom);
  const { setAnimationTarget } = useEditorActions();

  const handleZoomIn = () => {
    const newZoom = Math.min(ViewportZoom.MAX, targetZoom * 1.2);
    setAnimationTarget({ zoom: newZoom });
  };

  const handleZoomOut = () => {
    const newZoom = Math.max(ViewportZoom.MIN, targetZoom / 1.2);
    setAnimationTarget({ zoom: newZoom });
  };

  return (
    <CanvasViewportControls
      zoom={zoomValue}
      targetZoom={targetZoom}
      minZoom={ViewportZoom.MIN}
      maxZoom={ViewportZoom.MAX}
      onZoomIn={handleZoomIn}
      onZoomOut={handleZoomOut}
      onFit={onFit}
      fitTooltip="Fit to screen"
      visible={visible}
    />
  );
}

export default ViewportControls;
