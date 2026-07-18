import { useEffect, useRef } from 'react';

const SIMULATION_WIDTH = 64;
const SIMULATION_HEIGHT = 22;
const SOLVER_ITERATIONS = 7;
const FRAME_INTERVAL_MS = 1000 / 30;
const SWAP_DURATION_SECONDS = 0.6;

interface FluidState {
  width: number;
  height: number;
  stride: number;
  size: number;
  velocityX: Float32Array;
  velocityY: Float32Array;
  velocityXPrevious: Float32Array;
  velocityYPrevious: Float32Array;
  teal: Float32Array;
  amber: Float32Array;
  tealPrevious: Float32Array;
  amberPrevious: Float32Array;
  swapped: boolean;
  swapImpulse: number;
  swapProgress: number;
  settled: boolean;
}

interface CompareSlotFluidCanvasProps {
  hovered: boolean;
  swapped: boolean;
}

const indexOf = (state: FluidState, x: number, y: number): number => x + state.stride * y;

const setBoundary = (state: FluidState, boundary: 0 | 1 | 2, values: Float32Array) => {
  const { width, height } = state;
  for (let x = 1; x <= width; x += 1) {
    values[indexOf(state, x, 0)] =
      boundary === 2 ? -values[indexOf(state, x, 1)] : values[indexOf(state, x, 1)];
    values[indexOf(state, x, height + 1)] =
      boundary === 2 ? -values[indexOf(state, x, height)] : values[indexOf(state, x, height)];
  }
  for (let y = 1; y <= height; y += 1) {
    values[indexOf(state, 0, y)] =
      boundary === 1 ? -values[indexOf(state, 1, y)] : values[indexOf(state, 1, y)];
    values[indexOf(state, width + 1, y)] =
      boundary === 1 ? -values[indexOf(state, width, y)] : values[indexOf(state, width, y)];
  }

  values[indexOf(state, 0, 0)] =
    0.5 * (values[indexOf(state, 1, 0)] + values[indexOf(state, 0, 1)]);
  values[indexOf(state, 0, height + 1)] =
    0.5 * (values[indexOf(state, 1, height + 1)] + values[indexOf(state, 0, height)]);
  values[indexOf(state, width + 1, 0)] =
    0.5 * (values[indexOf(state, width, 0)] + values[indexOf(state, width + 1, 1)]);
  values[indexOf(state, width + 1, height + 1)] =
    0.5 * (values[indexOf(state, width, height + 1)] + values[indexOf(state, width + 1, height)]);
};

const linearSolve = (
  state: FluidState,
  boundary: 0 | 1 | 2,
  values: Float32Array,
  source: Float32Array,
  coefficientX: number,
  coefficientY: number,
  divisor: number,
) => {
  const { width, height } = state;
  for (let iteration = 0; iteration < SOLVER_ITERATIONS; iteration += 1) {
    for (let y = 1; y <= height; y += 1) {
      for (let x = 1; x <= width; x += 1) {
        const index = indexOf(state, x, y);
        values[index] =
          (source[index] +
            coefficientX * (values[index - 1] + values[index + 1]) +
            coefficientY * (values[index - state.stride] + values[index + state.stride])) /
          divisor;
      }
    }
    setBoundary(state, boundary, values);
  }
};

const diffuse = (
  state: FluidState,
  boundary: 0 | 1 | 2,
  output: Float32Array,
  source: Float32Array,
  diffusion: number,
  deltaSeconds: number,
) => {
  const coefficientX = deltaSeconds * diffusion * state.width * state.width;
  const coefficientY = deltaSeconds * diffusion * state.height * state.height;
  linearSolve(
    state,
    boundary,
    output,
    source,
    coefficientX,
    coefficientY,
    1 + 2 * (coefficientX + coefficientY),
  );
};

const advect = (
  state: FluidState,
  boundary: 0 | 1 | 2,
  output: Float32Array,
  source: Float32Array,
  velocityX: Float32Array,
  velocityY: Float32Array,
  deltaSeconds: number,
) => {
  const { width, height, stride } = state;
  const scaleX = deltaSeconds * width;
  const scaleY = deltaSeconds * height;

  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      const index = indexOf(state, x, y);
      const previousX = Math.max(0.5, Math.min(width + 0.5, x - scaleX * velocityX[index]));
      const previousY = Math.max(0.5, Math.min(height + 0.5, y - scaleY * velocityY[index]));
      const x0 = Math.floor(previousX);
      const x1 = x0 + 1;
      const y0 = Math.floor(previousY);
      const y1 = y0 + 1;
      const xFraction = previousX - x0;
      const yFraction = previousY - y0;

      output[index] =
        (1 - xFraction) *
          ((1 - yFraction) * source[x0 + stride * y0] + yFraction * source[x0 + stride * y1]) +
        xFraction *
          ((1 - yFraction) * source[x1 + stride * y0] + yFraction * source[x1 + stride * y1]);
    }
  }
  setBoundary(state, boundary, output);
};

const project = (
  state: FluidState,
  velocityX: Float32Array,
  velocityY: Float32Array,
  pressure: Float32Array,
  divergence: Float32Array,
) => {
  const { width, height, stride } = state;
  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      const index = indexOf(state, x, y);
      divergence[index] =
        -0.5 *
        ((velocityX[index + 1] - velocityX[index - 1]) / width +
          (velocityY[index + stride] - velocityY[index - stride]) / height);
      pressure[index] = 0;
    }
  }
  setBoundary(state, 0, divergence);
  setBoundary(state, 0, pressure);
  linearSolve(state, 0, pressure, divergence, 1, 1, 4);

  for (let y = 1; y <= height; y += 1) {
    for (let x = 1; x <= width; x += 1) {
      const index = indexOf(state, x, y);
      velocityX[index] -= 0.5 * width * (pressure[index + 1] - pressure[index - 1]);
      velocityY[index] -= 0.5 * height * (pressure[index + stride] - pressure[index - stride]);
    }
  }
  setBoundary(state, 1, velocityX);
  setBoundary(state, 2, velocityY);
};

const setFluidGradient = (state: FluidState, swapped: boolean) => {
  for (let y = 1; y <= state.height; y += 1) {
    for (let x = 1; x <= state.width; x += 1) {
      const horizontal = (x - 1) / Math.max(1, state.width - 1);
      const index = indexOf(state, x, y);
      state.teal[index] = swapped ? horizontal : 1 - horizontal;
      state.amber[index] = swapped ? 1 - horizontal : horizontal;
    }
  }
};

const createFluidState = (swapped: boolean): FluidState => {
  const width = SIMULATION_WIDTH;
  const height = SIMULATION_HEIGHT;
  const stride = width + 2;
  const size = stride * (height + 2);
  const state: FluidState = {
    width,
    height,
    stride,
    size,
    velocityX: new Float32Array(size),
    velocityY: new Float32Array(size),
    velocityXPrevious: new Float32Array(size),
    velocityYPrevious: new Float32Array(size),
    teal: new Float32Array(size),
    amber: new Float32Array(size),
    tealPrevious: new Float32Array(size),
    amberPrevious: new Float32Array(size),
    swapped,
    swapImpulse: 0,
    swapProgress: 1,
    settled: true,
  };
  setFluidGradient(state, swapped);
  return state;
};

const injectFlow = (state: FluidState, hovered: boolean, deltaSeconds: number) => {
  const { width, height } = state;
  const activity = (hovered ? 0.72 : 0.08) + state.swapImpulse * 1.65;

  for (let y = 1; y <= height; y += 1) {
    const normalizedY = (y - 1) / Math.max(1, height - 1);
    const upperCurrent = Math.exp(-Math.pow((normalizedY - 0.22) / 0.22, 2));
    const lowerCurrent = Math.exp(-Math.pow((normalizedY - 0.78) / 0.22, 2));
    for (let x = 1; x <= width; x += 1) {
      const normalizedX = (x - 1) / Math.max(1, width - 1);
      const index = indexOf(state, x, y);
      const edgeFade = Math.sin(Math.PI * normalizedX);
      const circulation = (upperCurrent - lowerCurrent) * edgeFade;
      state.velocityX[index] += deltaSeconds * activity * circulation * 0.68;
      state.velocityY[index] +=
        deltaSeconds *
        activity *
        Math.sin(normalizedX * Math.PI * 2 + normalizedY * Math.PI) *
        (upperCurrent + lowerCurrent) *
        0.055;

      if (state.swapImpulse > 0.01) {
        const centerX = normalizedX - 0.5;
        const centerY = normalizedY - 0.5;
        const falloff = Math.exp(-(centerX * centerX + centerY * centerY) * 5.5);
        state.velocityX[index] += deltaSeconds * state.swapImpulse * -centerY * falloff * 0.64;
        state.velocityY[index] += deltaSeconds * state.swapImpulse * centerX * falloff * 0.64;
      }
    }
  }

  const sourceWidth = Math.max(2, Math.round(width * 0.09));
  for (let y = 1; y <= height; y += 1) {
    const vertical = (y - 1) / Math.max(1, height - 1);
    for (let offset = 1; offset <= sourceWidth; offset += 1) {
      const leftIndex = indexOf(state, offset, y);
      const rightIndex = indexOf(state, width - offset + 1, y);
      const sourceStrength = deltaSeconds * (0.45 + 0.18 * Math.sin(vertical * Math.PI));
      if (state.swapped) {
        state.amber[leftIndex] = Math.min(1.3, state.amber[leftIndex] + sourceStrength);
        state.teal[rightIndex] = Math.min(1.3, state.teal[rightIndex] + sourceStrength);
      } else {
        state.teal[leftIndex] = Math.min(1.3, state.teal[leftIndex] + sourceStrength);
        state.amber[rightIndex] = Math.min(1.3, state.amber[rightIndex] + sourceStrength);
      }
    }
  }

  state.swapImpulse *= Math.pow(0.935, deltaSeconds * 30);
};

const smoothstep = (edgeStart: number, edgeEnd: number, value: number): number => {
  const normalized = Math.max(0, Math.min(1, (value - edgeStart) / (edgeEnd - edgeStart)));
  return normalized * normalized * (3 - 2 * normalized);
};

/**
 * Treat the two colors as immiscible phases: let advection lead the swap, then
 * progressively restore a clean interface so the motion resolves to the exact
 * reversed gradient instead of remaining muddy.
 */
const settleFluidPhases = (state: FluidState, deltaSeconds: number) => {
  state.swapProgress = Math.min(1, state.swapProgress + deltaSeconds / SWAP_DURATION_SECONDS);
  const finalPhase = smoothstep(0.32, 0.98, state.swapProgress);
  const relaxationPerSecond = state.settled ? 3.4 : 0.06 + Math.pow(finalPhase, 2.25) * 12;
  const blend = 1 - Math.exp(-relaxationPerSecond * deltaSeconds);

  for (let y = 1; y <= state.height; y += 1) {
    for (let x = 1; x <= state.width; x += 1) {
      const horizontal = (x - 1) / Math.max(1, state.width - 1);
      const targetTeal = state.swapped ? horizontal : 1 - horizontal;
      const targetAmber = 1 - targetTeal;
      const index = indexOf(state, x, y);
      state.teal[index] += (targetTeal - state.teal[index]) * blend;
      state.amber[index] += (targetAmber - state.amber[index]) * blend;
    }
  }

  if (state.swapProgress < 1 || state.settled) return;
  setFluidGradient(state, state.swapped);
  for (let index = 0; index < state.size; index += 1) {
    state.velocityX[index] *= 0.2;
    state.velocityY[index] *= 0.2;
  }
  state.settled = true;
};

const stepFluid = (state: FluidState, hovered: boolean, deltaSeconds: number) => {
  injectFlow(state, hovered, deltaSeconds);

  diffuse(state, 1, state.velocityXPrevious, state.velocityX, 0.000018, deltaSeconds);
  diffuse(state, 2, state.velocityYPrevious, state.velocityY, 0.000018, deltaSeconds);
  project(
    state,
    state.velocityXPrevious,
    state.velocityYPrevious,
    state.velocityX,
    state.velocityY,
  );
  advect(
    state,
    1,
    state.velocityX,
    state.velocityXPrevious,
    state.velocityXPrevious,
    state.velocityYPrevious,
    deltaSeconds,
  );
  advect(
    state,
    2,
    state.velocityY,
    state.velocityYPrevious,
    state.velocityXPrevious,
    state.velocityYPrevious,
    deltaSeconds,
  );
  project(
    state,
    state.velocityX,
    state.velocityY,
    state.velocityXPrevious,
    state.velocityYPrevious,
  );

  diffuse(state, 0, state.tealPrevious, state.teal, 0.000012, deltaSeconds);
  diffuse(state, 0, state.amberPrevious, state.amber, 0.000012, deltaSeconds);
  advect(state, 0, state.teal, state.tealPrevious, state.velocityX, state.velocityY, deltaSeconds);
  advect(
    state,
    0,
    state.amber,
    state.amberPrevious,
    state.velocityX,
    state.velocityY,
    deltaSeconds,
  );

  settleFluidPhases(state, deltaSeconds);

  const endDamping = state.settled ? 0 : smoothstep(0.62, 1, state.swapProgress);
  const velocityRetention = 0.992 - endDamping * 0.034;
  for (let index = 0; index < state.size; index += 1) {
    state.velocityX[index] *= velocityRetention;
    state.velocityY[index] *= velocityRetention;
    state.teal[index] *= 0.9992;
    state.amber[index] *= 0.9992;
  }
};

const parseCssRgb = (value: string, fallback: readonly [number, number, number]) => {
  const channels = value.trim().split(/\s+/).map(Number);
  return channels.length >= 3 && channels.slice(0, 3).every(Number.isFinite)
    ? ([channels[0], channels[1], channels[2]] as const)
    : fallback;
};

const renderFluid = (
  context: CanvasRenderingContext2D,
  imageData: ImageData,
  state: FluidState,
  tealColor: readonly [number, number, number],
) => {
  const amberColor = [252, 188, 54] as const;
  const baseColor = [38, 48, 64] as const;
  const pixels = imageData.data;
  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const fluidIndex = indexOf(state, x + 1, y + 1);
      const teal = Math.max(0, Math.min(1.2, state.teal[fluidIndex]));
      const amber = Math.max(0, Math.min(1.2, state.amber[fluidIndex]));
      const total = Math.max(0.001, teal + amber);
      const coverage = Math.min(0.94, total * 0.7);
      const mixing = (2 * Math.min(teal, amber)) / total;
      const mixingDarken = 1 - mixing * 0.2;
      const pixelIndex = (x + y * state.width) * 4;

      for (let channel = 0; channel < 3; channel += 1) {
        const fluidColor = (tealColor[channel] * teal + amberColor[channel] * amber) / total;
        pixels[pixelIndex + channel] = Math.round(
          (baseColor[channel] * (1 - coverage) + fluidColor * coverage) * mixingDarken,
        );
      }
      pixels[pixelIndex + 3] = 255;
    }
  }
  context.putImageData(imageData, 0, 0);
};

export function CompareSlotFluidCanvas({ hovered, swapped }: CompareSlotFluidCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fluidRef = useRef<FluidState | null>(null);
  const hoveredRef = useRef(hovered);
  const swappedRef = useRef(swapped);

  useEffect(() => {
    hoveredRef.current = hovered;
  }, [hovered]);

  useEffect(() => {
    swappedRef.current = swapped;
    const fluid = fluidRef.current;
    if (!fluid || fluid.swapped === swapped) return;
    fluid.swapped = swapped;
    fluid.swapImpulse = 1.35;
    fluid.swapProgress = 0;
    fluid.settled = false;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setFluidGradient(fluid, swapped);
      fluid.swapImpulse = 0;
      fluid.swapProgress = 1;
      fluid.settled = true;
    }
  }, [swapped]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) return;

    const fluid = createFluidState(swappedRef.current);
    fluidRef.current = fluid;
    const imageData = context.createImageData(fluid.width, fluid.height);
    const tealColor = parseCssRgb(
      getComputedStyle(canvas).getPropertyValue('--color-primary-300'),
      [94, 234, 212],
    );
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    let lastFrameAt = performance.now();

    const draw = (now: number) => {
      const elapsedMs = now - lastFrameAt;
      if (elapsedMs >= FRAME_INTERVAL_MS) {
        const deltaSeconds = Math.min(0.05, elapsedMs / 1000);
        if (!reducedMotion.matches && document.visibilityState !== 'hidden') {
          stepFluid(fluid, hoveredRef.current, deltaSeconds);
        }
        renderFluid(context, imageData, fluid, tealColor);
        lastFrameAt = now;
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    renderFluid(context, imageData, fluid, tealColor);
    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      fluidRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="compare-slot-swap__fluid-canvas"
      width={SIMULATION_WIDTH}
      height={SIMULATION_HEIGHT}
      aria-hidden="true"
    />
  );
}
