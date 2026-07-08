import { useEffect, useState, type RefObject } from 'react';

export type ViewportProximity = 'outside' | 'near' | 'visible';

export interface UseNearViewportOptions {
  root?: Element | null;
  rootMargin?: string;
  once?: boolean;
}

interface ObserverPool {
  observer: IntersectionObserver;
  callbacks: Map<Element, (entry: IntersectionObserverEntry) => void>;
}

const rootedObserverPools = new WeakMap<Element, Map<string, ObserverPool>>();
const viewportObserverPools = new Map<string, ObserverPool>();

const getPoolMap = (root: Element | null): Map<string, ObserverPool> => {
  if (!root) return viewportObserverPools;
  let pools = rootedObserverPools.get(root);
  if (!pools) {
    pools = new Map();
    rootedObserverPools.set(root, pools);
  }
  return pools;
};

const observeIntersection = (
  element: Element,
  root: Element | null,
  rootMargin: string,
  callback: (entry: IntersectionObserverEntry) => void,
): (() => void) => {
  const pools = getPoolMap(root);
  let pool = pools.get(rootMargin);
  if (!pool) {
    const callbacks = new Map<Element, (entry: IntersectionObserverEntry) => void>();
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((entry) => callbacks.get(entry.target)?.(entry)),
      { root, rootMargin },
    );
    pool = { observer, callbacks };
    pools.set(rootMargin, pool);
  }

  const activePool = pool;
  activePool.callbacks.set(element, callback);
  activePool.observer.observe(element);
  return () => {
    activePool.observer.unobserve(element);
    activePool.callbacks.delete(element);
    if (activePool.callbacks.size === 0) {
      activePool.observer.disconnect();
      pools.delete(rootMargin);
    }
  };
};

const intersects = (element: DOMRectReadOnly, root: DOMRectReadOnly): boolean =>
  element.bottom >= root.top &&
  element.top <= root.bottom &&
  element.right >= root.left &&
  element.left <= root.right;

export function useViewportProximity(
  ref: RefObject<Element | null>,
  options: UseNearViewportOptions = {},
): ViewportProximity {
  const { root: explicitRoot, rootMargin = '320px', once = false } = options;
  const [proximity, setProximity] = useState<ViewportProximity>('outside');

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setProximity('visible');
      return;
    }

    const root = explicitRoot ?? element.closest('.bb-scroll-area__viewport') ?? null;
    let stopObserving = () => undefined;
    stopObserving = observeIntersection(element, root, rootMargin, (entry) => {
      if (!entry.isIntersecting) {
        if (!once) setProximity('outside');
        return;
      }
      const visibleRoot = root?.getBoundingClientRect() ?? entry.rootBounds;
      const next =
        visibleRoot && intersects(entry.boundingClientRect, visibleRoot) ? 'visible' : 'near';
      setProximity(next);
      if (once) stopObserving();
    });
    return stopObserving;
  }, [explicitRoot, once, ref, rootMargin]);

  return proximity;
}

export function useNearViewport(
  ref: RefObject<Element | null>,
  options?: UseNearViewportOptions,
): boolean {
  return useViewportProximity(ref, options) !== 'outside';
}
