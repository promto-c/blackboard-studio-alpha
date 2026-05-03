import React, { useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface PopoverProps {
  trigger: React.ReactElement;
  children: React.ReactNode | ((close: () => void) => React.ReactNode);
  widthClass?: string;
  side?: 'top' | 'bottom' | 'right';
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  disableClickOutside?: boolean;
}

const Popover: React.FC<PopoverProps> = ({
  trigger,
  children,
  widthClass = 'w-48',
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  isOpen,
  onOpenChange,
  disableClickOutside = false,
}) => {
  const triggerRef = useRef<HTMLSpanElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);

  const closePopover = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleToggle = useCallback(() => {
    onOpenChange(!isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (isOpen && triggerRef.current && contentRef.current) {
      const contentEl = contentRef.current;

      const positioner = () => {
        if (!triggerRef.current || !contentEl) return;

        const triggerRect = triggerRef.current.getBoundingClientRect();
        const contentRect = contentEl.getBoundingClientRect();

        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let top, left;

        if (side === 'bottom') {
          top = triggerRect.bottom + sideOffset;
          if (align === 'center')
            left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
          else if (align === 'start') left = triggerRect.left;
          else left = triggerRect.right - contentRect.width;
        } else if (side === 'top') {
          top = triggerRect.top - contentRect.height - sideOffset;
          if (align === 'center')
            left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
          else if (align === 'start') left = triggerRect.left;
          else left = triggerRect.right - contentRect.width;
        } else if (side === 'right') {
          left = triggerRect.right + sideOffset;
          if (align === 'center')
            top = triggerRect.top + triggerRect.height / 2 - contentRect.height / 2;
          else if (align === 'start') top = triggerRect.top;
          else top = triggerRect.bottom - contentRect.height;
        } else {
          // Default bottom
          top = triggerRect.bottom + sideOffset;
          left = triggerRect.left + triggerRect.width / 2 - contentRect.width / 2;
        }

        // Boundary checks
        if (left < 8) left = 8;
        if (left + contentRect.width > viewportWidth - 8) {
          left = viewportWidth - contentRect.width - 8;
        }

        if (top < 8) top = 8;
        if (top + contentRect.height > viewportHeight - 8) {
          top = viewportHeight - contentRect.height - 8;
        }

        contentEl.style.top = `${top}px`;
        contentEl.style.left = `${left}px`;
      };

      const animationFrameId = requestAnimationFrame(positioner);

      return () => cancelAnimationFrame(animationFrameId);
    }
  }, [isOpen, side, align, sideOffset]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (disableClickOutside) return;
      if (
        isOpen &&
        contentRef.current &&
        !contentRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        closePopover();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (isOpen && event.key === 'Escape') {
        closePopover();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, closePopover, disableClickOutside]);

  useEffect(() => {
    const element = glowRef.current;
    if (!element) return;
    const handleMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      element.style.setProperty('--glow-x', `${e.clientX - rect.left}px`);
      element.style.setProperty('--glow-y', `${e.clientY - rect.top}px`);
    };
    const handleMouseEnter = () => {
      element.style.setProperty('--glow-opacity', '1');
      element.style.setProperty('--glow-scale', '1');
    };
    const handleMouseLeave = () => {
      element.style.setProperty('--glow-opacity', '0');
      element.style.setProperty('--glow-scale', '0');
    };
    element.addEventListener('mousemove', handleMouseMove);
    element.addEventListener('mouseenter', handleMouseEnter);
    element.addEventListener('mouseleave', handleMouseLeave);
    return () => {
      if (element) {
        element.removeEventListener('mousemove', handleMouseMove);
        element.removeEventListener('mouseenter', handleMouseEnter);
        element.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, [isOpen]);

  return (
    <span className="inline-flex items-center" onMouseDown={(e) => e.stopPropagation()}>
      <span
        ref={triggerRef}
        className="inline-flex items-center"
        onClick={(e) => {
          e.stopPropagation();
          handleToggle();
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        data-state={isOpen ? 'open' : 'closed'}
      >
        {trigger}
      </span>
      {isOpen &&
        createPortal(
          <div
            ref={contentRef}
            role="dialog"
            className="fixed z-[120] animate-[fadeIn_100ms_ease-out]"
          >
            <div
              ref={glowRef}
              className={`interactive-glow glass-component ${widthClass} bg-gray-900/80 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 ring-1 ring-inset ring-white/10`}
            >
              {typeof children === 'function' ? children(closePopover) : children}
            </div>
          </div>,
          document.body,
        )}
    </span>
  );
};

export default Popover;
