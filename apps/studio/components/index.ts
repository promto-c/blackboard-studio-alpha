// central barrel for app components
// re-export shared UI components and local helpers so code can import from '@/components'

// --- shared library components ---
import {
  CodeBlock,
  CollapsibleSection,
  ColorPicker,
  DiceIconButton,
  GlassSurface,
  KeyframeButton,
  Popover,
  PromptTextField,
  PropertyField,
  ResetIconButton,
  SegmentedControl,
  ShaderCodeModal,
  StyledDropdown,
  TextInputField,
  ToggleButton,
  ToggleSwitch,
} from '@blackboard/ui';

export {
  CodeBlock,
  CollapsibleSection,
  ColorPicker,
  DiceIconButton,
  GlassSurface,
  KeyframeButton,
  Popover,
  PromptTextField,
  PropertyField,
  ResetIconButton,
  SegmentedControl,
  ShaderCodeModal,
  StyledDropdown,
  TextInputField,
  ToggleButton,
  ToggleSwitch,
};
export { default as Slider, type SliderProps } from './Slider';

// icons are also available via the library; keep the namespace for convenience
export * as Icons from '@blackboard/icons';

// --- app-specific components ---
export { default as AttentionPulse } from './AttentionPulse';
export { default as BackgroundJobsMonitor } from './BackgroundJobsMonitor';
export { default as ConnectionBadge } from './ConnectionBadge';
export { default as GlobalTooltipLayer } from './GlobalTooltipLayer';
export { default as HotkeyBadge } from './HotkeyBadge';
export { default as InspectorLogFooter, type InspectorLogFooterProps } from './InspectorLogFooter';
export { default as ItemsHierarchyRenderer } from './ItemsHierarchyRenderer';
export { default as ImageThumbnail } from './ImageThumbnail';
export { default as ItemsPanelLayout } from './ItemsPanelLayout';
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
export { default as ItemsTreeView, type ItemsTreeDropIndicator } from './ItemsTreeView';
export { LayerRowShell, LeafItemRowShell } from './ItemsTreeRows';
export { default as LiveThumbnail } from './LiveThumbnail';
export { default as MediaSourceSelect } from './MediaSourceSelect';
export {
  default as NodeItemsPanel,
  getNodeItemsComponent,
  type NodeItemsPanelProps,
} from './NodeItemsPanel';
export { default as SettingsPanelFrame } from './SettingsPanelFrame';
export {
  StudioSegmentedControl,
  StudioSegmentedControlButton,
  type StudioSegmentedControlButtonProps,
  type StudioSegmentedControlProps,
} from './StudioSegmentedControl';
export { default as ToolButton } from './ToolButton';
export { default as ViewerSlotBadges } from './ViewerSlotBadges';
export { default as ViewportToolButton } from './ViewportToolButton';
export { ViewportToolPanel, ViewportToolPanelHeader } from './ViewportToolPanel';
export {
  default as FlowViewModeControls,
  type FlowViewModeControlsProps,
} from './FlowViewModeControls';
export { default as InspectorStack, type InspectorStackProps } from './InspectorStack';
