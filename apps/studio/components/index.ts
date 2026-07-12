// Studio-specific components. Shared primitives are imported from their packages directly.
export {
  PreferenceBentoCard,
  PreferenceBentoControl,
  PreferenceBentoEmptyState,
  PreferenceBentoResetButton,
  type PreferenceBentoIcon,
} from './PreferencesBento';

// --- app-specific components ---
export { AttentionPulse } from './AttentionPulse';
export { BackgroundJobsMonitor } from './BackgroundJobsMonitor';
export {
  ColorManagementControlRow,
  ColorManagementControlSection,
  type ColorManagementControlRowProps,
  type ColorManagementControlSectionProps,
} from './ColorManagementControls';
export {
  ColorManagementSettingsEditor,
  type ColorManagementSettingsEditorProps,
} from './ColorManagementSettingsEditor';
export {
  DisplayViewSelector,
  getDisplayViewSelectorModel,
  type DisplayViewSelectorProps,
} from './DisplayViewSelector';
export {
  InlineOptionList,
  type InlineOptionListOption,
  type InlineOptionListProps,
} from './InlineOptionList';
export { getProjectColorManagementPanelModel } from './ProjectColorManagementPanel';
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
export { Scene3DAssetPreview, type Scene3DAssetPreviewProps } from './Scene3DAssetPreview';
export {
  ColorManagedImagePreview,
  type ColorManagedImagePreviewProps,
} from './ColorManagedImagePreview';
export {
  ColorManagedVideoPreview,
  type ColorManagedVideoPreviewProps,
} from './ColorManagedVideoPreview';
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
export { OcioConfigSelector, type OcioConfigSelectorProps } from './OcioConfigSelector';
export {
  OcioContextVariablesEditor,
  type OcioContextVariablesEditorProps,
} from './OcioContextVariablesEditor';
export {
  MediaColorManagementControls,
  MediaColorManagementInspector,
  type MediaColorManagementControlsProps,
} from './MediaColorManagementInspector';
export { PwaStatusButton } from './PwaStatusButton';
export { PwaUpdateToast } from './PwaUpdateToast';
export {
  ExecuteButton,
  ExecuteButtonAction,
  ExecuteButtonGroup,
  ExecuteButtonMenuTrigger,
  ExecuteMenuItem,
} from './ExecuteButton';
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
export { SplitButton, type SplitButtonProps } from './SplitButton';
export { CheckboxIndicator, type CheckboxIndicatorProps } from './CheckboxIndicator';
export { ShaderCodeButton } from './ShaderCodeButton';
export { SettingRow } from './SettingRow';
export { ToggleSettingRow, type ToggleSettingRowProps } from './ToggleSettingRow';
export { UniformRenderer, type UniformRendererProps } from './UniformRenderer';
export { ToolButton } from './ToolButton';
export { ViewerSlotBadges } from './ViewerSlotBadges';
export { ViewportToolButton } from './ViewportToolButton';
export {
  ViewportToolPanel,
  ViewportToolPanelArea,
  ViewportToolPanelHeader,
  ViewportToolPanelSection,
  ViewportToolPanelSectionStack,
} from './ViewportToolPanel';
export { ViewportToolsRenderer } from './ViewportToolsRenderer';
export { WorkingSpaceField } from './WorkingSpaceField';
export {
  createLocatedExternalConfigReference,
  ExternalConfigReferenceField,
  type ExternalConfigReferenceFieldHandle,
  type ExternalConfigReferenceFieldProps,
} from './ExternalConfigReferenceField';
export { FlowViewModeControls, type FlowViewModeControlsProps } from './FlowViewModeControls';
export { InspectorStack, type InspectorStackProps } from './InspectorStack';
