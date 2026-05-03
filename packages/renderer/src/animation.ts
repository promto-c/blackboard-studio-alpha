import { AnimatableNumber, Keyframe, RotoPath } from '@blackboard/types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const toFiniteNumber = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? value : fallback;

const sanitizeTangent = (tangent: { x: number; y: number }, minX: number, maxX: number) => ({
  x: clamp(toFiniteNumber(tangent.x), minX, maxX),
  y: toFiniteNumber(tangent.y),
});

export const getSegmentTangents = (prevKey: Keyframe, nextKey: Keyframe) => {
  const frameDiff = nextKey.frame - prevKey.frame;
  if (!Number.isFinite(frameDiff) || frameDiff <= 0) {
    return {
      frameDiff,
      outTangent: { x: 0, y: 0 },
      inTangent: { x: 0, y: 0 },
    };
  }

  const defaultOut = { x: frameDiff / 3, y: 0 };
  const defaultIn = { x: -frameDiff / 3, y: 0 };

  let outTangent = sanitizeTangent(prevKey.outTangent ?? defaultOut, 0, frameDiff);
  let inTangent = sanitizeTangent(nextKey.inTangent ?? defaultIn, -frameDiff, 0);

  const x1 = prevKey.frame + outTangent.x;
  const x2 = nextKey.frame + inTangent.x;
  if (x1 > x2) {
    const mid = (prevKey.frame + nextKey.frame) / 2;
    outTangent = { ...outTangent, x: mid - prevKey.frame };
    inTangent = { ...inTangent, x: mid - nextKey.frame };
  }

  return { frameDiff, outTangent, inTangent };
};

export const clampKeyframeTangents = (keyframes: Keyframe[], index: number): Keyframe => {
  const keyframe = keyframes[index];
  if (!keyframe) return keyframe;

  const prev = keyframes[index - 1];
  const next = keyframes[index + 1];

  let inTangent = keyframe.inTangent;
  let outTangent = keyframe.outTangent;

  if (inTangent) {
    const minX = prev ? prev.frame - keyframe.frame : Number.NEGATIVE_INFINITY;
    inTangent = sanitizeTangent(inTangent, minX, 0);
  }

  if (outTangent) {
    const maxX = next ? next.frame - keyframe.frame : Number.POSITIVE_INFINITY;
    outTangent = sanitizeTangent(outTangent, 0, maxX);
  }

  if (inTangent === keyframe.inTangent && outTangent === keyframe.outTangent) {
    return keyframe;
  }

  return {
    ...keyframe,
    inTangent,
    outTangent,
  };
};

// Helper to set nested properties immutably
export const setImmutable = (obj: any, path: string, value: any): any => {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (!obj) return undefined;
  const newObj = Array.isArray(obj) ? [...obj] : { ...obj };
  let current: any = newObj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKeyIsNumber = /^\d+$/.test(keys[i + 1]);
    const currentValue = current[key];

    if (currentValue === undefined || currentValue === null) {
      // If the path doesn't exist, create it.
      current[key] = nextKeyIsNumber ? [] : {};
    } else {
      // If it exists, clone it to maintain immutability.
      current[key] = Array.isArray(currentValue) ? [...currentValue] : { ...currentValue };
    }
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return newObj;
};

// Helper to get nested properties
export const getImmutable = (obj: any, path: string): any => {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  return keys.reduce((acc, part) => acc && acc[part], obj);
};

export const getSortedKeyframes = (prop: AnimatableNumber): Keyframe[] => {
  if (typeof prop === 'number' || !prop || (Array.isArray(prop) && prop.length === 0)) {
    return [];
  }
  // Ensure prop is an array before sorting
  if (Array.isArray(prop)) {
    return [...prop].sort((a, b) => a.frame - b.frame);
  }
  return [];
};

// Cubic Bezier interpolation functions
const B = (t: number, p0: number, p1: number, p2: number, p3: number) => {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
};

const getTforX = (x: number, x0: number, x1: number, x2: number, x3: number): number => {
  // We are looking for a t in [0, 1] such that B(t) = x.
  // We can use binary search because for animation curves, x(t) is monotonic.
  let t0 = 0.0;
  let t1 = 1.0;
  let t = t0;

  for (let i = 0; i < 8; i++) {
    // 8 iterations is usually enough
    t = (t0 + t1) / 2;
    const currentX = B(t, x0, x1, x2, x3);
    if (Math.abs(currentX - x) < 0.001) break;

    if (currentX < x) {
      t0 = t;
    } else {
      t1 = t;
    }
  }
  return t;
};

export const getValueAtFrame = (prop: AnimatableNumber, frame: number): number => {
  if (typeof prop === 'number') {
    return prop;
  }

  const sortedKeyframes = getSortedKeyframes(prop);
  if (sortedKeyframes.length === 0) {
    return 0; // Default value for an empty keyframe array
  }

  // Before the first keyframe
  if (frame <= sortedKeyframes[0].frame) {
    return sortedKeyframes[0].value;
  }

  // After the last keyframe
  if (frame >= sortedKeyframes[sortedKeyframes.length - 1].frame) {
    return sortedKeyframes[sortedKeyframes.length - 1].value;
  }

  // Between keyframes
  for (let i = 0; i < sortedKeyframes.length - 1; i++) {
    const prevKey = sortedKeyframes[i];
    const nextKey = sortedKeyframes[i + 1];

    if (frame >= prevKey.frame && frame <= nextKey.frame) {
      const { frameDiff, outTangent, inTangent } = getSegmentTangents(prevKey, nextKey);
      if (!Number.isFinite(frameDiff) || frameDiff <= 0) return prevKey.value;

      // Bezier control points
      const p0 = { x: prevKey.frame, y: prevKey.value };
      const p1 = { x: prevKey.frame + outTangent.x, y: prevKey.value + outTangent.y };
      const p2 = { x: nextKey.frame + inTangent.x, y: nextKey.value + inTangent.y };
      const p3 = { x: nextKey.frame, y: nextKey.value };

      // Get t for the current frame
      const t = getTforX(frame, p0.x, p1.x, p2.x, p3.x);

      // Calculate the value using t
      return B(t, p0.y, p1.y, p2.y, p3.y);
    }
  }

  // Should not be reached if logic is correct
  return sortedKeyframes[sortedKeyframes.length - 1].value;
};

export const getLinearValueAtFrame = (prop: AnimatableNumber, frame: number): number => {
  if (typeof prop === 'number') {
    return prop;
  }

  const sortedKeyframes = getSortedKeyframes(prop);
  if (sortedKeyframes.length === 0) {
    return 0;
  }

  if (frame <= sortedKeyframes[0].frame) {
    return sortedKeyframes[0].value;
  }

  if (frame >= sortedKeyframes[sortedKeyframes.length - 1].frame) {
    return sortedKeyframes[sortedKeyframes.length - 1].value;
  }

  for (let i = 0; i < sortedKeyframes.length - 1; i++) {
    const prevKey = sortedKeyframes[i];
    const nextKey = sortedKeyframes[i + 1];

    if (frame >= prevKey.frame && frame <= nextKey.frame) {
      const frameDiff = nextKey.frame - prevKey.frame;
      if (!Number.isFinite(frameDiff) || frameDiff <= 0) return prevKey.value;

      const t = (frame - prevKey.frame) / frameDiff;
      return prevKey.value + (nextKey.value - prevKey.value) * t;
    }
  }

  return sortedKeyframes[sortedKeyframes.length - 1].value;
};

export const hasKeyframeAt = (prop: AnimatableNumber, frame: number): boolean => {
  if (typeof prop === 'number' || !prop) {
    return false;
  }
  return prop.some((k) => k.frame === frame);
};

export const setKeyframeOnValue = (
  prop: AnimatableNumber,
  frame: number,
  value?: number,
): AnimatableNumber => {
  let keyframes: Keyframe[];
  let finalProp: AnimatableNumber;

  // --- Determine next state of keyframes ---
  if (value !== undefined) {
    // SET operation: add or update a keyframe
    keyframes = Array.isArray(prop) ? [...prop] : [{ frame: 0, value: prop }];
    const existingIndex = keyframes.findIndex((k) => k.frame === frame);
    if (existingIndex > -1) {
      keyframes[existingIndex] = { ...keyframes[existingIndex], value };
    } else {
      keyframes.push({ frame, value });
    }
  } else {
    // TOGGLE operation: add or remove a keyframe
    const valueAtFrame = getValueAtFrame(prop, frame);
    keyframes = Array.isArray(prop) ? [...prop] : [];
    const existingIndex = keyframes.findIndex((k) => k.frame === frame);

    if (existingIndex > -1) {
      keyframes.splice(existingIndex, 1);
    } else {
      keyframes.push({ frame, value: valueAtFrame });
    }
  }

  const sortedKeyframes = keyframes.sort((a, b) => a.frame - b.frame);

  // Update tangents for new/modified keyframes
  for (let i = 0; i < sortedKeyframes.length; i++) {
    const kf = sortedKeyframes[i];
    if (!kf.inTangent || !kf.outTangent) {
      const prevKf = i > 0 ? sortedKeyframes[i - 1] : null;
      const nextKf = i < sortedKeyframes.length - 1 ? sortedKeyframes[i + 1] : null;
      const prevDelta = prevKf ? Math.abs(kf.frame - prevKf.frame) : 0;
      const nextDelta = nextKf ? Math.abs(nextKf.frame - kf.frame) : 0;
      const inTangentX = prevKf ? -prevDelta / 3 : -nextDelta / 3;
      const outTangentX = nextKf ? nextDelta / 3 : prevDelta / 3;

      if (!kf.inTangent) kf.inTangent = { x: inTangentX, y: 0 };
      if (!kf.outTangent) kf.outTangent = { x: outTangentX, y: 0 };
    }
  }

  // --- Simplify or format the final property value ---
  if (sortedKeyframes.length === 0) {
    // No keyframes left, revert to static number using value at current frame
    finalProp = getValueAtFrame(prop, frame);
  } else {
    // Keep as array even if it has only 1 keyframe, to maintain "keyed" status on timeline
    finalProp = sortedKeyframes;
  }

  return finalProp;
};

// Syncs all points in a roto path to have keyframes at the specified frame
export const syncRotoKeyframes = (path: RotoPath, frame: number): RotoPath => {
  const newPoints = path.points.map((pt) => ({
    x: setKeyframeOnValue(pt.x, frame, getValueAtFrame(pt.x, frame)),
    y: setKeyframeOnValue(pt.y, frame, getValueAtFrame(pt.y, frame)),
  }));
  return { ...path, points: newPoints };
};
