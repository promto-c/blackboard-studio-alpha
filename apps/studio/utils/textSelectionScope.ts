import isTextEntryTarget from './isTextEntryTarget';

export const TEXT_SELECTION_SCOPE_SELECTOR = '[data-text-selection-scope]';

const TEXT_SELECTION_TARGET_SELECTOR = [
  '[data-selectable-text]',
  'code',
  'kbd',
  'label',
  'output',
  'p',
  'pre',
  'span',
  'time',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
].join(',');

const TEXT_SELECTION_EXCLUDED_TARGET_SELECTOR = [
  '[data-text-selection-exclude]',
  'button',
  '[role="button"]',
  'input[type="range"]',
  'select',
  'summary',
  '[draggable="true"]',
  '.select-none',
].join(',');

const getElementFromTarget = (target: EventTarget | null): Element | null => {
  if (target instanceof Element) {
    return target;
  }

  if (target instanceof Node) {
    return target.parentElement;
  }

  return null;
};

export const getTextSelectionScope = (target: EventTarget | null): HTMLElement | null => {
  const element = getElementFromTarget(target);
  const scope = element?.closest(TEXT_SELECTION_SCOPE_SELECTOR);
  return scope instanceof HTMLElement ? scope : null;
};

export const isSelectableTextTarget = (target: EventTarget | null): boolean => {
  const element = getElementFromTarget(target);
  const scope = getTextSelectionScope(target);
  if (!element || !scope) {
    return false;
  }

  if (isTextEntryTarget(element)) {
    return true;
  }

  if (element.closest(TEXT_SELECTION_EXCLUDED_TARGET_SELECTOR)) {
    return false;
  }

  return Boolean(element.closest(TEXT_SELECTION_TARGET_SELECTOR));
};

const isNodeInside = (container: HTMLElement, node: Node | null): node is Node =>
  Boolean(node && container.contains(node));

const isNodeBeforeScope = (scope: HTMLElement, node: Node | null): boolean => {
  if (!node) {
    return false;
  }

  return Boolean(scope.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);
};

export const clampSelectionToScope = (selection: Selection, scope: HTMLElement): boolean => {
  const anchorNode = selection.anchorNode;
  if (!isNodeInside(scope, anchorNode)) {
    selection.removeAllRanges();
    return true;
  }

  const focusNode = selection.focusNode;
  const focusIsBeforeScope = !isNodeInside(scope, focusNode) && isNodeBeforeScope(scope, focusNode);
  const range = document.createRange();
  range.selectNodeContents(scope);

  try {
    if (focusIsBeforeScope) {
      range.setEnd(anchorNode, selection.anchorOffset);
    } else {
      range.setStart(anchorNode, selection.anchorOffset);
    }
  } catch {
    selection.removeAllRanges();
    return true;
  }

  selection.removeAllRanges();
  selection.addRange(range);
  return true;
};

export const selectTextSelectionScope = (scope: HTMLElement): boolean => {
  const selection = document.getSelection();
  if (!selection) {
    return false;
  }

  const range = document.createRange();
  range.selectNodeContents(scope);
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
};
