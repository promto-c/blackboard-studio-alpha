import { useEditorSelector, useEditorActions } from '@/state/editorContext';
import type {
  ViewportToolEntry,
  ViewportToolDefinition,
  ViewportToolSeparator,
} from '@/nodes/NodeDefinition';
import { ViewportToolButton } from './ViewportToolButton';

interface ViewportToolsRendererProps {
  tools: ViewportToolEntry[];
  openPanels: ReadonlySet<string>;
  onPanelToggle: (panel: string) => void;
}

/**
 * Default renderer for declarative `viewportTools` arrays on NodeDefinition.
 *
 * Handles:
 * - Basic tool activation (one-click select)
 * - Toggle tools (on/off)
 * - Panel-trigger tools
 * - Separator elements
 */
export function ViewportToolsRenderer({
  tools,
  openPanels,
  onPanelToggle,
}: ViewportToolsRendererProps) {
  const activeViewportTool = useEditorSelector((s) => s.activeViewportTool);
  const { setActiveViewportTool } = useEditorActions();

  return (
    <>
      {tools.map((entry, index) => {
        if (isSeparator(entry)) {
          return <div key={`sep-${index}`} className="w-full h-px bg-gray-700/50 my-1" />;
        }

        const tool = entry;
        const isActive = resolveIsActive(tool, activeViewportTool, openPanels);
        const settingsPanelId = tool.panelId;

        const handleClick = () => {
          if (tool.isPanel) {
            onPanelToggle(settingsPanelId ?? tool.id);
          } else if (tool.isToggle) {
            setActiveViewportTool(activeViewportTool === tool.id ? null : tool.id);
          } else {
            setActiveViewportTool(tool.id);
          }
        };

        const handleSettingsClick = settingsPanelId
          ? () => onPanelToggle(settingsPanelId)
          : undefined;

        const labelWithHotkey = tool.hotkey ? `${tool.label} (${tool.hotkey})` : tool.label;

        return (
          <ViewportToolButton
            key={tool.id}
            label={labelWithHotkey}
            icon={<tool.icon className="h-5 w-5" />}
            isActive={isActive}
            onClick={handleClick}
            onSettingsClick={handleSettingsClick}
            isSettingsActive={settingsPanelId ? openPanels.has(settingsPanelId) : undefined}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSeparator(entry: ViewportToolEntry): entry is ViewportToolSeparator {
  return 'kind' in entry && entry.kind === 'separator';
}

function resolveIsActive(
  tool: ViewportToolDefinition,
  activeViewportTool: string | null,
  openPanels: ReadonlySet<string>,
): boolean {
  if (tool.isPanel) {
    return openPanels.has(tool.panelId ?? tool.id);
  }
  if (tool.isToggle) {
    return activeViewportTool === tool.id;
  }
  return activeViewportTool === tool.id;
}
