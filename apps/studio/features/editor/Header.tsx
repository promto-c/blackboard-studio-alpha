import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import PreferencesView from '@/features/projects/PreferencesView';
import * as Icons from '@blackboard/icons';
import BackgroundJobsMonitor from '@/components/BackgroundJobsMonitor';

const COMPACT_JOBS_VIEWPORT_WIDTH = 980;

const Header: React.FC = () => {
  const [isPreferencesOpen, setPreferencesOpen] = useState(false);
  const [isJobsCompact, setIsJobsCompact] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const rightControlsRef = useRef<HTMLDivElement>(null);
  const preferencesButtonRef = useRef<HTMLButtonElement>(null);
  const hasOpenedPreferencesRef = useRef(false);

  useEffect(() => {
    const updateJobsLayout = () => {
      const editorElement = rootRef.current?.parentElement;
      const panelWidth = editorElement
        ? Number.parseFloat(getComputedStyle(editorElement).getPropertyValue('--panel-width')) || 0
        : 0;
      const viewportWidth = window.innerWidth - panelWidth;

      setIsJobsCompact(viewportWidth < COMPACT_JOBS_VIEWPORT_WIDTH);
    };

    updateJobsLayout();

    const editorElement = rootRef.current?.parentElement;
    const observer =
      editorElement && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateJobsLayout)
        : null;

    if (editorElement) {
      observer?.observe(editorElement);
    }

    window.addEventListener('resize', updateJobsLayout);
    window.addEventListener('studio-editor-layout-resize', updateJobsLayout);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateJobsLayout);
      window.removeEventListener('studio-editor-layout-resize', updateJobsLayout);
    };
  }, []);

  useLayoutEffect(() => {
    const editorElement = rootRef.current?.parentElement;
    if (!editorElement) return;

    const updateControlsWidth = () => {
      const width = rightControlsRef.current?.getBoundingClientRect().width ?? 0;
      editorElement.style.setProperty('--top-right-controls-width', `${width}px`);
      window.dispatchEvent(new CustomEvent('studio-top-right-controls-resize'));
    };

    updateControlsWidth();

    const observer =
      rightControlsRef.current && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(updateControlsWidth)
        : null;

    if (rightControlsRef.current) {
      observer?.observe(rightControlsRef.current);
    }

    window.addEventListener('resize', updateControlsWidth);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateControlsWidth);
      editorElement.style.removeProperty('--top-right-controls-width');
    };
  }, [isJobsCompact]);

  useEffect(() => {
    if (!isPreferencesOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPreferencesOpen(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPreferencesOpen]);

  useEffect(() => {
    if (isPreferencesOpen) {
      hasOpenedPreferencesRef.current = true;
      return;
    }
    if (!hasOpenedPreferencesRef.current) return;
    preferencesButtonRef.current?.focus();
  }, [isPreferencesOpen]);

  return (
    <>
      <div ref={rootRef} className="pointer-events-none absolute inset-x-0 top-4 z-50">
        <div
          ref={rightControlsRef}
          className="pointer-events-auto absolute right-4 top-0 flex gap-2"
        >
          <BackgroundJobsMonitor className="relative" compact={isJobsCompact} />

          <button
            ref={preferencesButtonRef}
            type="button"
            onClick={() => setPreferencesOpen(true)}
            className="interactive-glow glass-component flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-gray-950/55 text-gray-300 shadow-2xl backdrop-blur-xl ring-1 ring-inset ring-white/10 transition hover:border-white/20 hover:bg-gray-900/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60"
            title="Preferences"
            aria-label="Preferences"
            aria-haspopup="dialog"
            aria-expanded={isPreferencesOpen}
          >
            <Icons.Cog className="h-5 w-5" />
          </button>
        </div>
      </div>

      {isPreferencesOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Preferences"
          className="fixed inset-0 z-[70] flex items-start justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setPreferencesOpen(false);
            }
          }}
        >
          <div className="w-full max-w-5xl">
            <PreferencesView onBack={() => setPreferencesOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
};

export default Header;
