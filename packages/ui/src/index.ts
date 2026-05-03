// @blackboard/ui — Shared UI components and icons

// --- Components ---
export { default as CodeBlock, type CodeBlockProps } from './CodeBlock';
export { default as CollapsibleSection } from './CollapsibleSection';
export { default as ColorPicker } from './ColorPicker';
export { default as DirectoryImportModeModal } from './DirectoryImportModeModal';
export { default as DiceIconButton, type DiceIconButtonProps } from './DiceIconButton';
export { default as GlassSurface, type GlassSurfaceProps } from './GlassSurface';
export { default as IconButton, type IconButtonProps } from './IconButton';
export { default as KeyframeButton } from './KeyframeButton';
export { default as PixelInspector } from './PixelInspector';
export { default as Popover } from './Popover';
export { default as PromptTextField, type PromptTextFieldProps } from './PromptTextField';
export { default as PropertyField, type PropertyFieldProps } from './PropertyField';
export { default as ResetIconButton, type ResetIconButtonProps } from './ResetIconButton';
export {
  default as ResizableScrollTextarea,
  type ResizableScrollTextareaProps,
} from './ResizableScrollTextarea';
export { default as ScrollArea, type ScrollAreaAxis, type ScrollAreaProps } from './ScrollArea';
export { default as SegmentedControl } from './SegmentedControl';
export { default as ShaderCodeModal } from './ShaderCodeModal';
export { default as Slider, type SliderProps } from './Slider';
export { default as SplitterHandle, type SplitterHandleProps } from './SplitterHandle';
export { default as StyledDropdown } from './StyledDropdown';
export { default as TextInputField, type TextInputFieldProps } from './TextInputField';
export { default as ToggleButton, type ToggleButtonProps } from './ToggleButton';
export { default as ToggleSwitch, type ToggleSwitchProps } from './ToggleSwitch';

// --- Icons ---
// icons now live in a dedicated package; re-export for convenience
export * as Icons from '@blackboard/icons';
