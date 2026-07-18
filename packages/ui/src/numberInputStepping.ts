const MAX_CARET_DECIMAL_PLACES = 12;
const MIN_CARET_PLACE = -MAX_CARET_DECIMAL_PLACES;
const MAX_CARET_PLACE = 308;

interface NumericTextParts {
  exponent: number;
  mantissaEnd: number;
  text: string;
}

export interface NumericCaretStep {
  affinity: 'after' | 'before';
  place: number;
  step: number;
}

export interface ExtendedNumericPrecision {
  caret: number;
  text: string;
}

const parseNumericText = (value: string): NumericTextParts | null => {
  const text = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text)) return null;

  const exponentIndex = text.search(/[eE]/);
  const exponent = exponentIndex === -1 ? 0 : Number(text.slice(exponentIndex + 1));
  if (!Number.isInteger(exponent)) return null;

  return {
    exponent,
    mantissaEnd: exponentIndex === -1 ? text.length : exponentIndex,
    text,
  };
};

const getDigitPlace = (parts: NumericTextParts, digitIndex: number): number => {
  const decimalIndex = parts.text.indexOf('.');
  const decimalPlace =
    decimalIndex !== -1 && decimalIndex < parts.mantissaEnd ? decimalIndex : parts.mantissaEnd;
  const mantissaPlace =
    digitIndex < decimalPlace ? decimalPlace - digitIndex - 1 : decimalPlace - digitIndex;
  return mantissaPlace + parts.exponent;
};

const getCaretDigit = (
  parts: NumericTextParts,
  caret: number,
): (Pick<NumericCaretStep, 'affinity'> & { index: number }) | null => {
  // Editing the exponent is deliberately left to the configured input step. The
  // digit places in the mantissa already include that exponent.
  if (caret > parts.mantissaEnd) return null;

  for (let index = Math.min(caret - 1, parts.mantissaEnd - 1); index >= 0; index -= 1) {
    if (/\d/.test(parts.text[index] ?? '')) return { affinity: 'after', index };
  }

  for (let index = Math.max(0, caret); index < parts.mantissaEnd; index += 1) {
    if (/\d/.test(parts.text[index] ?? '')) return { affinity: 'before', index };
  }

  return null;
};

/**
 * Resolves the decimal place represented by a text caret. The nearest digit to
 * the left wins; only a caret with no digit to its left falls forward to the
 * first digit on its right.
 */
export const getNumericCaretStep = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): NumericCaretStep | null => {
  const parts = parseNumericText(value);
  if (!parts || selectionStart === null || selectionEnd === null) return null;

  const leadingWhitespace = value.length - value.trimStart().length;
  const caret = Math.max(0, selectionEnd - leadingWhitespace);
  const digit = getCaretDigit(parts, caret);
  if (!digit) return null;

  const place = Math.min(
    MAX_CARET_PLACE,
    Math.max(MIN_CARET_PLACE, getDigitPlace(parts, digit.index)),
  );
  const step = 10 ** place;
  return Number.isFinite(step) && step > 0 ? { affinity: digit.affinity, place, step } : null;
};

/** Finds the caret position for the same decimal place after a value changes. */
export const getCaretPositionForNumericPlace = (value: string, place: number): number | null => {
  const parts = parseNumericText(value);
  if (!parts) return null;

  let firstDigit: number | null = null;
  let lastDigit: number | null = null;
  for (let index = 0; index < parts.mantissaEnd; index += 1) {
    if (!/\d/.test(parts.text[index] ?? '')) continue;
    firstDigit ??= index;
    lastDigit = index;
    if (getDigitPlace(parts, index) === place) {
      return value.length - value.trimStart().length + index;
    }
  }

  if (firstDigit === null || lastDigit === null) return null;
  const firstPlace = getDigitPlace(parts, firstDigit);
  const fallbackIndex = place > firstPlace ? firstDigit : lastDigit + 1;
  return value.length - value.trimStart().length + fallbackIndex;
};

/**
 * Adds one editable decimal place when a collapsed caret moves right from the
 * end of a plain numeric value.
 */
export const extendNumericPrecisionAtCaret = (
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): ExtendedNumericPrecision | null => {
  const parts = parseNumericText(value);
  if (
    !parts ||
    parts.mantissaEnd !== parts.text.length ||
    selectionStart === null ||
    selectionStart !== selectionEnd
  ) {
    return null;
  }

  const leadingWhitespace = value.length - value.trimStart().length;
  const caret = selectionStart - leadingWhitespace;
  if (caret !== parts.mantissaEnd) return null;

  const decimalIndex = parts.text.indexOf('.');
  const fractionDigits = decimalIndex === -1 ? 0 : parts.mantissaEnd - decimalIndex - 1;
  if (fractionDigits >= MAX_CARET_DECIMAL_PLACES) return null;

  const extension = decimalIndex === -1 ? '.0' : '0';
  const text = `${parts.text}${extension}`;
  return { caret: leadingWhitespace + text.length, text };
};

export const formatValueForNumericPlace = (
  value: number,
  place: number,
  currentText: string,
): string => {
  const parts = parseNumericText(currentText);
  let currentFractionDigits = 0;
  if (parts) {
    for (let index = parts.mantissaEnd - 1; index >= 0; index -= 1) {
      if (!/\d/.test(parts.text[index] ?? '')) continue;
      currentFractionDigits = Math.max(0, -getDigitPlace(parts, index));
      break;
    }
  }

  const fractionDigits = Math.min(
    MAX_CARET_DECIMAL_PLACES,
    Math.max(currentFractionDigits, -place),
  );
  return fractionDigits === 0 ? String(value) : value.toFixed(fractionDigits);
};
