import type { AnyNode, EditorTab, RotoPointRef, ViewerSlot } from '@blackboard/types';

export type HotkeyScopeId =
  | 'global'
  | 'flow'
  | 'flow.list'
  | 'flow.graph'
  | 'viewport'
  | 'timeline'
  | 'timeline.dopesheet'
  | 'timeline.graph';

export type HotkeyView = 'global' | 'flow' | 'viewport' | 'timeline';

export interface HotkeyModifiers {
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  mod: boolean;
  shift: boolean;
}

export interface KeyboardSnapshot {
  activeScopeId: HotkeyScopeId;
  activeScopePath: HotkeyScopeId[];
  focusedScopeId: HotkeyScopeId | null;
  pointerScopeId: HotkeyScopeId | null;
  pressedCodes: ReadonlySet<string>;
  pressedKeys: ReadonlySet<string>;
  modifiers: HotkeyModifiers;
}

export interface HotkeyContext {
  activeScopeId: HotkeyScopeId;
  activeScopePath: HotkeyScopeId[];
  activeView: HotkeyView;
  flowMode: 'list' | 'graph' | null;
  timelineMode: 'dopesheet' | 'graph' | null;
  activeTab: EditorTab | null;
  target: EventTarget | null;
  isTextEntry: boolean;
  currentFrame: number;
  maxFrames: number;
  isDrawing: boolean;
  selectedNode: AnyNode | null;
  selectedNodeType: string | null;
  selectedNodeId: string | null;
  selectedRotoPathIds: string[];
  selectedRotoPointRefs: RotoPointRef[];
  recentRotoPointRefs: RotoPointRef[];
  activeViewportTool: string | null;
  selectedViewerTargetId: string | null;
  viewerSlot: ViewerSlot | null;
  modifiers: HotkeyModifiers;
  keyboard: KeyboardSnapshot;
}

export interface HotkeyExecutionContext extends HotkeyContext {
  actions: Record<string, unknown>;
}

export type HotkeyWhen = (context: HotkeyContext) => boolean;
export type HotkeyCommandHandler<TArgs = unknown> = (
  context: HotkeyExecutionContext,
  args: TArgs,
) => boolean | void;

export interface HotkeyCommand<TArgs = unknown> {
  id: string;
  title?: string;
  run: HotkeyCommandHandler<TArgs>;
}

export interface HotkeyBinding<TArgs = unknown> {
  keys: string | string[];
  command: string;
  args?: TArgs;
  scope?: HotkeyScopeId | HotkeyScopeId[];
  when?: HotkeyWhen;
  weight?: number;
  preventDefault?: boolean;
  allowInTextEntry?: boolean;
  repeat?: boolean;
}

export interface HotkeyScopeRegistration {
  id: HotkeyScopeId;
  parentId?: HotkeyScopeId;
  element: HTMLElement;
}
