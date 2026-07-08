import { useMemo, useState } from 'react';
import * as Icons from '@blackboard/icons';
import { Badge, Popover } from '@blackboard/ui';
import { getNativeDesktopVersion, isNativeDesktopApp } from '@/desktop/nativeDesktop';

interface NativeDesktopStatusButtonProps {
  className?: string;
}

export function NativeDesktopStatusButton({ className = '' }: NativeDesktopStatusButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isNative = useMemo(() => isNativeDesktopApp(), []);
  const version = getNativeDesktopVersion();

  if (!isNative) return null;

  const buttonClassName =
    className ||
    'interactive-glow glass-component relative flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-gray-950/55 text-emerald-100 shadow-2xl backdrop-blur-xl ring-1 ring-inset ring-white/10 transition hover:border-emerald-200/30 hover:bg-gray-900/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400/60';

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      align="end"
      widthClass="w-72 max-w-[calc(100vw-2rem)]"
      trigger={
        <button
          type="button"
          className={buttonClassName}
          title="Native Desktop"
          aria-label="Native Desktop"
        >
          <Icons.ComputerDesktop className="h-5 w-5" />
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.7)]" />
        </button>
      }
    >
      {() => (
        <div className="space-y-3" data-text-selection-scope>
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-300/30 bg-emerald-300/15 text-emerald-100">
              <Icons.ComputerDesktop className="h-[18px] w-[18px]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-gray-100">Native Desktop</p>
              <p className="mt-0.5 truncate text-[11px] text-gray-500">
                Blackboard Studio v{version}
              </p>
            </div>
            <Badge
              size="sm"
              variant="neutral"
              shrink
              className="!py-1 text-[10px] font-semibold !bg-black/20 !text-emerald-200"
            >
              Tauri
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
              <p className="text-gray-500">Mode</p>
              <p className="text-emerald-200">Installed</p>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/20 px-2 py-2">
              <p className="text-gray-500">Runtime</p>
              <p className="text-gray-200">Desktop</p>
            </div>
          </div>
        </div>
      )}
    </Popover>
  );
}
