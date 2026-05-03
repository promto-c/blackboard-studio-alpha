import { useState, useEffect } from 'react';

export enum LayoutMode {
  Desktop,
  MobilePortrait,
}

// Corresponds to Tailwind's 'md' breakpoint
const MOBILE_BREAKPOINT = 768;

const getLayoutMode = (): LayoutMode => {
  const isPortrait = window.matchMedia('(orientation: portrait)').matches;
  const isSmallScreen = window.innerWidth < MOBILE_BREAKPOINT;

  // If it's a small screen AND in portrait mode, use the mobile layout.
  // Otherwise (e.g., mobile in landscape, tablet, desktop), use the desktop layout.
  if (isSmallScreen && isPortrait) {
    return LayoutMode.MobilePortrait;
  }
  return LayoutMode.Desktop;
};

const useDeviceLayout = () => {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(getLayoutMode);

  useEffect(() => {
    const handleResize = () => {
      setLayoutMode(getLayoutMode());
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return layoutMode;
};

export default useDeviceLayout;
