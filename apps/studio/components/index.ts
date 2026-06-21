// central barrel for app components
// re-export UI helpers and local components so code can import from '@/components'

// app-specific re-exports
export { Slider, type SliderProps } from './Slider';

// --- app-specific components ---
export { AttentionPulse } from './AttentionPulse';
export { BackgroundJobsMonitor } from './BackgroundJobsMonitor';
export { ConnectionBadge } from './ConnectionBadge';
export { GlobalTooltipLayer } from './GlobalTooltipLayer';
export { HotkeyBadge } from './HotkeyBadge';
export { InspectorLogFooter, type InspectorLogFooterProps } from './InspectorLogFooter';
export {
  InspectorBreadcrumb,
  type InspectorBreadcrumbProps,
  type InspectorBreadcrumbSegment,
} from './InspectorBreadcrumb';
export { ItemsHierarchyRenderer } from './ItemsHierarchyRenderer';
export { AssetViewer, type AssetViewerMedia } from './AssetViewer';
export { ImageThumbnail } from './ImageThumbnail';
export { ItemsPanelLayout } from './ItemsPanelLayout';
export {
  FloatingMenu,
  HEADER_SELECTION_CHIP_CLASS,
  HEADER_SELECTION_ICON_BUTTON_CLASS,
  LayerPlusIcon,
  MenuButton,
  MenuSectionLabel,
  MoveMenuSection,
  countLabel,
  type LayerOption,
} from './ItemsPanelMenus';
export { ItemsTreeView, type ItemsTreeDropIndicator } from './ItemsTreeView';
export { LayerRowShell, LeafItemRowShell } from './ItemsTreeRows';
export { LiveThumbnail } from './LiveThumbnail';
export { MarkdownNote } from './MarkdownNote';
export { MediaSourceSelect } from './MediaSourceSelect';
export { NativeDesktopStatusButton } from './NativeDesktopStatusButton';
export { NodeItemsPanel, getNodeItemsComponent, type NodeItemsPanelProps } from './NodeItemsPanel';
export { OcioColorSpaceDropdown } from './OcioColorSpaceDropdown';
export { PwaStatusButton } from './PwaStatusButton';
export { PwaUpdateToast } from './PwaUpdateToast';
export { SettingsPanelFrame } from './SettingsPanelFrame';
// SegmentedControl is the unified component supporting both options-based and children-based APIs.
// SlidingSegmentedControl is the animated variant built on top.
export {
  SlidingSegmentedControl,
  type SlidingSegmentedControlOption,
  type SlidingSegmentedControlProps,
} from './SlidingSegmentedControl';
// SegmentedControl is the unified component supporting both options-based
// and children-based APIs. SegmentedControlButton is the sub-button for
// children mode.
export {
  SegmentedControl,
  SegmentedControlButton,
  type SegmentedControlButtonProps,
  type SegmentedControlProps,
  type SegmentOption,
} from './SegmentedControl';
export { ShaderCodeButton } from './ShaderCodeButton';
export { SettingRow } from './SettingRow';
export { UniformRenderer, type UniformRendererProps } from './UniformRenderer';
export { ToolButton } from './ToolButton';
export { ViewerSlotBadges } from './ViewerSlotBadges';
export { ViewportToolButton } from './ViewportToolButton';
export {
  ViewportToolPanel,
  ViewportToolPanelArea,
  ViewportToolPanelHeader,
} from './ViewportToolPanel';
export { ViewportToolsRenderer } from './ViewportToolsRenderer';
export { FlowViewModeControls, type FlowViewModeControlsProps } from './FlowViewModeControls';
export { InspectorStack, type InspectorStackProps } from './InspectorStack';
