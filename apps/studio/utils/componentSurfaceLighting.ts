const GLASS_SURFACE_SELECTOR =
  '.bb-control-button, .bb-dropdown-surface, .bb-control-input, .bb-control-well, .bb-segmented-surface-button, .compare-slot-swap';

type GlassEdge = 'top' | 'right' | 'bottom' | 'left';

export interface GlassSurfaceLighting {
  edges: Record<GlassEdge, { alpha: number; thickness: number }>;
  glowX: number;
  glowY: number;
  glowAlpha: number;
  aberrationOpacity: number;
  lightX: number;
  lightY: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const getGlassSurfaceLighting = (
  pointerX: number,
  pointerY: number,
  width: number,
  height: number,
): GlassSurfaceLighting => {
  const x = clamp01(width > 0 ? pointerX / width : 0.5);
  const y = clamp01(height > 0 ? pointerY / height : 0.5);
  const proximity: Record<GlassEdge, number> = {
    top: 1 - y,
    right: x,
    bottom: y,
    left: 1 - x,
  };

  const edges = Object.fromEntries(
    (Object.entries(proximity) as Array<[GlassEdge, number]>).map(([edge, value]) => {
      const energy = value * value;
      return [
        edge,
        {
          alpha: 0.035 + energy * 0.28,
          thickness: 0.8 + energy * 2.2,
        },
      ];
    }),
  ) as GlassSurfaceLighting['edges'];

  return {
    edges,
    glowX: (x - 0.5) * 3,
    glowY: (y - 0.5) * 3,
    glowAlpha: 0.08 + Math.max(...Object.values(proximity)) * 0.08,
    aberrationOpacity: 0.24 + Math.max(...Object.values(proximity)) * 0.28,
    lightX: x * 100,
    lightY: y * 100,
  };
};

const clearLighting = (element: HTMLElement | null) => {
  if (!element) return;
  [
    '--bb-rim-top-alpha',
    '--bb-rim-right-alpha',
    '--bb-rim-bottom-alpha',
    '--bb-rim-left-alpha',
    '--bb-rim-top-size',
    '--bb-rim-right-size',
    '--bb-rim-bottom-size',
    '--bb-rim-left-size',
    '--bb-glow-x',
    '--bb-glow-y',
    '--bb-glow-alpha',
    '--bb-aberration-opacity',
    '--bb-aberration-top-alpha',
    '--bb-aberration-right-alpha',
    '--bb-aberration-bottom-alpha',
    '--bb-aberration-left-alpha',
    '--bb-light-x',
    '--bb-light-y',
  ].forEach((property) => element.style.removeProperty(property));
};

const applyLighting = (element: HTMLElement, clientX: number, clientY: number) => {
  const rect = element.getBoundingClientRect();
  const lighting = getGlassSurfaceLighting(
    clientX - rect.left,
    clientY - rect.top,
    rect.width,
    rect.height,
  );

  (
    Object.entries(lighting.edges) as Array<[GlassEdge, GlassSurfaceLighting['edges'][GlassEdge]]>
  ).forEach(([edge, value]) => {
    element.style.setProperty(`--bb-rim-${edge}-alpha`, value.alpha.toFixed(3));
    element.style.setProperty(`--bb-rim-${edge}-size`, `${value.thickness.toFixed(2)}px`);
    element.style.setProperty(
      `--bb-aberration-${edge}-alpha`,
      (value.alpha * lighting.aberrationOpacity * 0.9).toFixed(3),
    );
  });
  element.style.setProperty('--bb-glow-x', `${lighting.glowX.toFixed(2)}px`);
  element.style.setProperty('--bb-glow-y', `${lighting.glowY.toFixed(2)}px`);
  element.style.setProperty('--bb-glow-alpha', lighting.glowAlpha.toFixed(3));
  element.style.setProperty('--bb-aberration-opacity', lighting.aberrationOpacity.toFixed(3));
  element.style.setProperty('--bb-light-x', `${lighting.lightX.toFixed(1)}%`);
  element.style.setProperty('--bb-light-y', `${lighting.lightY.toFixed(1)}%`);
};

export const initComponentSurfaceLighting = (): (() => void) => {
  let activeElement: HTMLElement | null = null;
  let activeSelectionIndicator: HTMLElement | null = null;
  let pendingEvent: PointerEvent | null = null;
  let lastEvent: PointerEvent | null = null;
  let animationFrame = 0;

  const update = () => {
    animationFrame = 0;
    const event = pendingEvent ?? lastEvent;
    pendingEvent = null;
    if (!event || document.documentElement.dataset.componentStyle !== 'glass') {
      clearLighting(activeElement);
      clearLighting(activeSelectionIndicator);
      activeElement = null;
      activeSelectionIndicator = null;
      return;
    }

    const eventElement = event.target instanceof Element ? event.target : null;
    const target =
      (eventElement?.closest('.bb-split-control') as HTMLElement | null) ??
      (eventElement?.closest(GLASS_SURFACE_SELECTOR) as HTMLElement | null);
    if (target !== activeElement) {
      clearLighting(activeElement);
      clearLighting(activeSelectionIndicator);
      activeElement = target;
      activeSelectionIndicator = null;
    }
    if (!target) return;

    applyLighting(target, event.clientX, event.clientY);

    const selectionIndicator = target.matches('.bb-segmented-control')
      ? target.querySelector<HTMLElement>('.bb-segmented-selection-indicator')
      : null;
    if (selectionIndicator !== activeSelectionIndicator) {
      clearLighting(activeSelectionIndicator);
      activeSelectionIndicator = selectionIndicator;
    }
    if (selectionIndicator) applyLighting(selectionIndicator, event.clientX, event.clientY);

    if (target.dataset.segmentMoving === 'true' && !animationFrame) {
      animationFrame = window.requestAnimationFrame(update);
    }
  };

  const handlePointerActivity = (event: PointerEvent) => {
    lastEvent = event;
    pendingEvent = event;
    if (!animationFrame) animationFrame = window.requestAnimationFrame(update);
  };

  const handlePointerLeave = () => {
    pendingEvent = null;
    lastEvent = null;
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    animationFrame = 0;
    clearLighting(activeElement);
    clearLighting(activeSelectionIndicator);
    activeElement = null;
    activeSelectionIndicator = null;
  };

  document.addEventListener('pointermove', handlePointerActivity, { passive: true });
  document.addEventListener('pointerdown', handlePointerActivity, { passive: true });
  document.addEventListener('pointerup', handlePointerActivity, { passive: true });
  document.documentElement.addEventListener('pointerleave', handlePointerLeave);
  const styleObserver = new MutationObserver(() => {
    if (document.documentElement.dataset.componentStyle !== 'glass') handlePointerLeave();
  });
  styleObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-component-style'],
  });

  return () => {
    document.removeEventListener('pointermove', handlePointerActivity);
    document.removeEventListener('pointerdown', handlePointerActivity);
    document.removeEventListener('pointerup', handlePointerActivity);
    document.documentElement.removeEventListener('pointerleave', handlePointerLeave);
    styleObserver.disconnect();
    if (animationFrame) window.cancelAnimationFrame(animationFrame);
    clearLighting(activeElement);
    clearLighting(activeSelectionIndicator);
  };
};
