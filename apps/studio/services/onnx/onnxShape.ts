export function isDynamicDim(dim: number): boolean {
  return typeof dim !== 'number' || dim <= 0;
}

export function isDynamicShape(dims: readonly number[]): boolean {
  return dims.some(isDynamicDim);
}

export function formatOnnxShape(dims: readonly number[]): string {
  return dims.map((d) => (isDynamicDim(d) ? '?' : String(d))).join(' × ');
}

export function inferInputKind(dims: readonly number[], _type: string): 'image' | 'scalar' {
  if (dims.length >= 3) return 'image';
  return 'scalar';
}

export function inferOutputKind(dims: readonly number[], _type: string): 'image' | 'scalar' {
  if (dims.length >= 3) return 'image';
  return 'scalar';
}

export function validateTensorShape(
  expectedDims: readonly number[],
  actualDims: readonly number[],
): string[] {
  const errors: string[] = [];

  expectedDims.forEach((expectedDim, index) => {
    if (isDynamicDim(expectedDim)) return;

    if (actualDims[index] !== expectedDim) {
      errors.push(`Dim ${index} requires ${expectedDim}, got ${actualDims[index]}`);
    }
  });

  return errors;
}
