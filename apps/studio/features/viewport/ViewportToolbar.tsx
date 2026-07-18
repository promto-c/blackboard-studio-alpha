import React, { useMemo, useState, useCallback } from 'react';
import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import { useSelectedEditorNode } from '@/hooks/useEditorNodes';
import { nodeRegistry } from '@/nodes/registry';
import { AnyNode, NodeType, StabilizationScope } from '@blackboard/types';
import * as Icons from '@blackboard/icons';
import { useRegisterHotkeyCommands, useRegisterHotkeys } from '@/hotkeys';
import type { HotkeyBinding, HotkeyCommand } from '@/hotkeys';
import { ToggleButton } from '@blackboard/ui';
import {
  ViewportToolButton,
  ViewportToolPanel,
  ViewportToolPanelArea,
  ViewportToolPanelHeader,
  ViewportToolsRenderer,
} from '@/components';
import { toggleTransformWithHierarchy } from '@/utils/transformHierarchy';

type ViewportToolsProps = {
  node: AnyNode;
  openPanels: ReadonlySet<string>;
  onPanelToggle: (panel: string) => void;
};

type ViewportToolPanelProps = {
  node: AnyNode;
  activeTool: string | null;
  openPanels: ReadonlySet<string>;
  onPanelClose: (panel: string) => void;
};

function StabilizePanel({ onClose }: { onClose: () => void }) {
  const isStabilized = useEditorSelector((s) => s.isStabilized);
  const stabilizationConfig = useEditorSelector((s) => s.stabilizationConfig);
  const { toggleStabilize, setStabilizationConfig } = useEditorActions();

  const handleToggle = (field: 'translation' | 'rotation' | 'scale' | 'affine' | 'perspective') => {
    setStabilizationConfig(toggleTransformWithHierarchy(stabilizationConfig, field));
  };

  const handleScopeChange = (scope: StabilizationScope) => {
    setStabilizationConfig({ scope });
  };

  return (
    <ViewportToolPanel>
      <ViewportToolPanelHeader
        title="Stabilize View"
        onClose={onClose}
        toggle={{
          active: isStabilized,
          onToggle: toggleStabilize,
        }}
      />
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label className="text-[10px] text-gray-400 font-medium">Components</label>
          <div className="flex gap-1">
            <ToggleButton
              label="Trans"
              active={stabilizationConfig.translation}
              onClick={() => handleToggle('translation')}
              icon={<Icons.ArrowsRightLeft className="h-4 w-4" />}
            />
            <ToggleButton
              label="Scale"
              active={stabilizationConfig.scale}
              onClick={() => handleToggle('scale')}
              icon={<Icons.ArrowsPointingOut className="h-4 w-4" />}
            />
            <ToggleButton
              label="Rot"
              active={stabilizationConfig.rotation}
              onClick={() => handleToggle('rotation')}
              icon={<Icons.RotateLoop className="h-4 w-4" />}
            />
          </div>
          <div className="flex gap-1">
            <ToggleButton
              label="Shear"
              active={stabilizationConfig.affine}
              onClick={() => handleToggle('affine')}
              icon={<Icons.Shear className="h-4 w-4" />}
            />
            <ToggleButton
              label="Persp"
              active={stabilizationConfig.perspective}
              onClick={() => handleToggle('perspective')}
              icon={<Icons.CubeTransparent className="h-4 w-4" />}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] text-gray-400 font-medium">Transform Scope</label>
          <div className="flex gap-1">
            <ToggleButton
              label="Parent"
              active={stabilizationConfig.scope === 'parent'}
              onClick={() => handleScopeChange('parent')}
              icon={<Icons.Branch className="h-4 w-4" />}
              title="Stabilize using parent layers' tracking and user transform"
            />
            <ToggleButton
              label="Shape"
              active={
                stabilizationConfig.scope === 'composite' || stabilizationConfig.scope === 'target'
              }
              onClick={() => handleScopeChange('composite')}
              icon={<Icons.Curve className="h-4 w-4" />}
              title="Stabilize using parent layers + selected shape/layer tracking and user transform"
            />
            <ToggleButton
              label="Full"
              active={stabilizationConfig.scope === 'full'}
              onClick={() => handleScopeChange('full')}
              icon={<Icons.Stack className="h-4 w-4" />}
              title="Stabilize using all tracking + user positioning"
            />
          </div>
          <p className="text-[10px] leading-4 text-gray-500">
            Parent: parent tracking + parent user transform. Shape: parents + self + user transform.
            Full: shape scope plus derived position translation.
          </p>
        </div>
      </div>
    </ViewportToolPanel>
  );
}

function ViewportToolbar() {
  const selectedNodeId = useEditorSelector((s) => s.selectedNodeId);
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const isStabilized = useEditorSelector((s) => s.isStabilized);
  const { toggleStabilize } = useEditorActions();

  // Which secondary panel (auto-trace / tracking / motion-cue / stabilize / …) is open.
  // Owned here so both the icon strip and the panel column stay in sync
  // without either component needing to know about the other.
  const [openPanels, setOpenPanels] = useState<Set<string>>(() => new Set());

  const selectedNode = useSelectedEditorNode() ?? null;
  // Close all panels when the selected node changes
  const prevNodeId = React.useRef(selectedNodeId);
  if (prevNodeId.current !== selectedNodeId) {
    prevNodeId.current = selectedNodeId;
    if (openPanels.size > 0) setOpenPanels(new Set());
  }

  const definition = useMemo(() => {
    if (!selectedNode) return null;
    return nodeRegistry.get(selectedNode.type) ?? null;
  }, [selectedNode]);

  const ToolsComponent = definition?.ViewportToolsComponent as
    | React.ComponentType<ViewportToolsProps>
    | undefined;
  const tools = definition?.viewportTools;

  const ToolPanelComponent = definition?.ViewportToolPanelComponent as
    | React.ComponentType<ViewportToolPanelProps>
    | undefined;

  const hasStabilize = !!definition?.getStabilizeTransform;
  const hasTools = !!ToolsComponent || (tools && tools.length > 0);

  const handlePanelToggle = useCallback((panel: string) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) next.delete(panel);
      else next.add(panel);
      return next;
    });
  }, []);

  const handlePanelClose = useCallback((panel: string) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      next.delete(panel);
      return next;
    });
  }, []);

  const viewportToolbarCommands = useMemo<HotkeyCommand[]>(
    () => [
      {
        id: 'viewport.toggleRotoTrackingPanel.runtime',
        run: (context) => {
          if (context.selectedNodeType !== NodeType.ROTO) {
            return false;
          }
          handlePanelToggle('tracking');
          return true;
        },
      },
    ],
    [handlePanelToggle],
  );

  const viewportToolbarBindings = useMemo<HotkeyBinding[]>(
    () => [
      ...(selectedNode?.type === NodeType.ROTO
        ? [
            {
              keys: 'T',
              command: 'viewport.toggleRotoTrackingPanel.runtime',
              scope: 'viewport',
              weight: 400,
            } satisfies HotkeyBinding,
          ]
        : []),
    ],
    [selectedNode?.type],
  );

  useRegisterHotkeyCommands('viewport.toolbar', viewportToolbarCommands);
  useRegisterHotkeys('viewport.toolbar', viewportToolbarBindings);

  if (!selectedNode || (!hasTools && !ToolPanelComponent && !hasStabilize)) {
    return null;
  }

  const showEffectPanel =
    ToolPanelComponent && Array.from(openPanels).some((panel) => panel !== 'stabilize');
  const showStabilizePanel = openPanels.has('stabilize') && hasStabilize;
  const showPanelColumn = showEffectPanel || showStabilizePanel;

  return (
    <div className="absolute inset-y-0 left-4 right-4 z-20 pointer-events-none flex flex-row items-center gap-2">
      {/* Main tool icon strip — always vertically centered */}
      {(hasTools || hasStabilize) && (
        <div className="relative z-30 self-center pointer-events-auto overflow-visible glass-component flex flex-col items-center gap-1 bg-gray-900/50 backdrop-blur-xl border border-white/10 rounded-lg shadow-lg p-1.5 ring-1 ring-inset ring-white/20 animate-[fadeIn_150ms_ease-out]">
          {ToolsComponent ? (
            <ToolsComponent
              node={selectedNode}
              openPanels={openPanels}
              onPanelToggle={handlePanelToggle}
            />
          ) : tools ? (
            <ViewportToolsRenderer
              tools={tools}
              openPanels={openPanels}
              onPanelToggle={handlePanelToggle}
            />
          ) : null}
          {hasStabilize && (
            <>
              {hasTools && <div className="w-full h-px bg-gray-700/50 my-1" />}
              <ViewportToolButton
                label="Stabilize View"
                icon={<Icons.LockClosed className="h-5 w-5" />}
                isActive={isStabilized}
                onClick={toggleStabilize}
                onSettingsClick={() => handlePanelToggle('stabilize')}
                isSettingsActive={openPanels.has('stabilize')}
              />
            </>
          )}
        </div>
      )}

      {/* Per-tool side panels share one bounded, resizable column. */}
      {showPanelColumn && (
        <ViewportToolPanelArea>
          {showEffectPanel && ToolPanelComponent && (
            <ToolPanelComponent
              node={selectedNode}
              activeTool={activeViewportTool}
              openPanels={openPanels}
              onPanelClose={handlePanelClose}
            />
          )}
          {showStabilizePanel && <StabilizePanel onClose={() => handlePanelClose('stabilize')} />}
        </ViewportToolPanelArea>
      )}
    </div>
  );
}

export default ViewportToolbar;
