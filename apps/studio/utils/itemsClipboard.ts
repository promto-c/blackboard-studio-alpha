export interface ItemsClipboardRecord<TKind extends string = string, TPayload = unknown> {
  kind: TKind;
  version: 1;
  payload: TPayload;
}

let currentItemsClipboard: ItemsClipboardRecord<string, unknown> | null = null;

const cloneClipboardValue = <T>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
};

export const writeItemsClipboard = <TKind extends string, TPayload>(
  record: ItemsClipboardRecord<TKind, TPayload>,
): void => {
  currentItemsClipboard = cloneClipboardValue(record) as ItemsClipboardRecord<string, unknown>;
};

export const readItemsClipboard = <TKind extends string, TPayload>(
  kind: TKind,
): ItemsClipboardRecord<TKind, TPayload> | null => {
  if (!currentItemsClipboard || currentItemsClipboard.kind !== kind) {
    return null;
  }

  return cloneClipboardValue(currentItemsClipboard as ItemsClipboardRecord<TKind, TPayload>);
};

export const hasItemsClipboard = (kind?: string): boolean => {
  if (!currentItemsClipboard) {
    return false;
  }

  return kind ? currentItemsClipboard.kind === kind : true;
};

export const clearItemsClipboard = (): void => {
  currentItemsClipboard = null;
};
