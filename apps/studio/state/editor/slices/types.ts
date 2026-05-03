import { getInitialState } from '@/state/editor/initialState';

export type EditorState = ReturnType<typeof getInitialState> & { maxFrames: number };
export type SetState = (fn: (prevState: EditorState) => Partial<EditorState> | EditorState) => void;
export type GetState = () => EditorState;
