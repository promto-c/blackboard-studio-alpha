export interface KeyerSampleDrag {
  nodeId: string;
  start: { x: number; y: number };
  current: { x: number; y: number };
}

let drag: KeyerSampleDrag | null = null;
const listeners = new Set<() => void>();

export const getKeyerSampleDrag = (): KeyerSampleDrag | null => drag;

export const subscribeKeyerSampleDrag = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const setKeyerSampleDrag = (nextDrag: KeyerSampleDrag | null): void => {
  drag = nextDrag;
  listeners.forEach((listener) => listener());
};
