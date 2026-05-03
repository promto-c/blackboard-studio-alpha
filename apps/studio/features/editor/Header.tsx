import React, { useEffect, useRef, useState } from 'react';
import PreferencesView from '@/features/projects/PreferencesView';
import * as Icons from '@blackboard/icons';

const Header: React.FC = () => {
  const [isPreferencesOpen, setPreferencesOpen] = useState(false);
  const preferencesButtonRef = useRef<HTMLButtonElement>(null);
  const hasOpenedPreferencesRef = useRef(false);

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
      <div className="pointer-events-auto absolute right-4 top-4 z-50">
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
