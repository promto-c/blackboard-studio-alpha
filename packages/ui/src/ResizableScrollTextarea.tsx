import React from 'react';
import ScrollArea from './ScrollArea';
import { CONTROL_INPUT_CONTAINER_CLASS } from './controlInputStyles';

const joinClassNames = (...values: Array<string | undefined | false>) =>
  values.filter(Boolean).join(' ');

export interface ResizableScrollTextareaProps extends Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  'className' | 'style'
> {
  rootClassName?: string;
  viewportClassName?: string;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
  minHeight?: number;
  maxHeight?: number;
  initialMaxHeight?: number;
  resizeStep?: number;
  resizeLabel?: string;
}

const ResizableScrollTextarea = React.forwardRef<HTMLTextAreaElement, ResizableScrollTextareaProps>(
  (
    {
      rootClassName,
      viewportClassName,
      textareaClassName,
      textareaStyle,
      minHeight = 96,
      maxHeight = 280,
      initialMaxHeight = 136,
      resizeStep = 12,
      resizeLabel = 'Resize text area',
      value,
      defaultValue,
      onChange,
      ...props
    },
    ref,
  ) => {
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const dragStartRef = React.useRef<{ height: number; y: number } | null>(null);
    const [contentHeight, setContentHeight] = React.useState(minHeight);
    const [visibleMaxHeight, setVisibleMaxHeight] = React.useState(initialMaxHeight);

    const setTextareaRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          ref.current = node;
        }
      },
      [ref],
    );

    const measureContentHeight = React.useCallback(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      textarea.style.height = 'auto';
      const nextHeight = Math.max(minHeight, textarea.scrollHeight);
      textarea.style.height = `${nextHeight}px`;
      setContentHeight((current) => (Math.abs(current - nextHeight) < 1 ? current : nextHeight));
    }, [minHeight]);

    React.useLayoutEffect(() => {
      measureContentHeight();
    }, [measureContentHeight, value, defaultValue]);

    React.useEffect(() => {
      setVisibleMaxHeight((current) => Math.min(maxHeight, Math.max(minHeight, current)));
    }, [maxHeight, minHeight]);

    React.useEffect(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      const handler = (e: WheelEvent) => {
        e.stopPropagation();
      };
      textarea.addEventListener('wheel', handler);
      return () => textarea.removeEventListener('wheel', handler);
    }, []);

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      measureContentHeight();
    };

    const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragStartRef.current = {
        height: visibleMaxHeight,
        y: event.clientY,
      };
    };

    const handleResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const dragStart = dragStartRef.current;
      if (!dragStart) return;

      const nextHeight = dragStart.height + event.clientY - dragStart.y;
      setVisibleMaxHeight(Math.min(maxHeight, Math.max(minHeight, nextHeight)));
    };

    const handleResizePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
      dragStartRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    };

    const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

      event.preventDefault();
      setVisibleMaxHeight((current) =>
        Math.min(
          maxHeight,
          Math.max(minHeight, current + (event.key === 'ArrowDown' ? resizeStep : -resizeStep)),
        ),
      );
    };

    return (
      <div
        className={joinClassNames(
          'relative transition',
          CONTROL_INPUT_CONTAINER_CLASS,
          rootClassName,
        )}
      >
        <ScrollArea
          axis="y"
          viewportClassName={joinClassNames('rounded-lg', viewportClassName)}
          viewportStyle={{ maxHeight: visibleMaxHeight, minHeight }}
        >
          <textarea
            {...props}
            ref={setTextareaRef}
            value={value}
            defaultValue={defaultValue}
            onChange={handleChange}
            style={{ ...textareaStyle, height: contentHeight }}
            className={joinClassNames(
              'block min-h-9 w-full resize-none overflow-hidden bg-transparent px-2.5 py-2 pr-6 pb-6 text-xs leading-5 text-gray-200 outline-none placeholder:text-gray-500 disabled:cursor-not-allowed disabled:opacity-55',
              textareaClassName,
            )}
          />
        </ScrollArea>
        <div
          role="slider"
          tabIndex={0}
          aria-label={resizeLabel}
          aria-valuemin={minHeight}
          aria-valuemax={maxHeight}
          aria-valuenow={Math.round(visibleMaxHeight)}
          title={resizeLabel}
          onPointerDown={handleResizePointerDown}
          onPointerMove={handleResizePointerMove}
          onPointerUp={handleResizePointerEnd}
          onPointerCancel={handleResizePointerEnd}
          onKeyDown={handleResizeKeyDown}
          className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none select-none rounded-br-lg opacity-55 transition hover:opacity-100 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary-400/20"
        >
          <span className="absolute bottom-1 right-1 h-2.5 w-2.5 rounded-br-md border-b border-r border-white/25" />
          <span className="absolute bottom-1.5 right-1.5 h-1.5 w-1.5 rounded-br border-b border-r border-white/20" />
        </div>
      </div>
    );
  },
);

ResizableScrollTextarea.displayName = 'ResizableScrollTextarea';

export default ResizableScrollTextarea;
