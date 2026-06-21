import { deepClone } from './deepClone';

interface ItemsClipboardRecord<TKind extends string = string, TPayload = unknown> {
  kind: TKind;
  version: 1;
  payload: TPayload;
}

let currentItemsClipboard: ItemsClipboardRecord<string, unknown> | null = null;

export const writeItemsClipboard = <TKind extends string, TPayload>(
  record: ItemsClipboardRecord<TKind, TPayload>,
): void => {
  currentItemsClipboard = deepClone(record) as ItemsClipboardRecord<string, unknown>;
};

export const readItemsClipboard = <TKind extends string, TPayload>(
  kind: TKind,
): ItemsClipboardRecord<TKind, TPayload> | null => {
  if (!currentItemsClipboard || currentItemsClipboard.kind !== kind) {
    return null;
  }

  return deepClone(currentItemsClipboard as ItemsClipboardRecord<TKind, TPayload>);
};
