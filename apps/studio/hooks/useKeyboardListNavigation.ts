import { useEffect, useRef, useState } from 'react';

interface UseKeyboardListNavigationOptions {
  /** Length of the list of items to navigate */
  itemsLength: number;
  /** Called when Enter or Tab is pressed on the active item */
  onSelect: (index: number) => void;
  /** Whether keyboard navigation is enabled (default: true) */
  enabled?: boolean;
}

interface UseKeyboardListNavigationResult {
  /** Current active (highlighted) index */
  activeIndex: number;
  /** Direct setter for activeIndex — useful to reset to 0 on search/filter changes */
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  /** Attach to the search/input element's onKeyDown */
  handleKeyDown: (event: React.KeyboardEvent) => void;
  /** Attach to the options container div's ref for scrollIntoView */
  optionsContainerRef: React.RefObject<HTMLDivElement | null>;
  /** Returns per-item props: onMouseEnter for hover sync, and isActive for styling */
  getItemProps: (index: number) => {
    onMouseEnter: () => void;
    isActive: boolean;
  };
}

/**
 * Reusable hook for keyboard navigation in option/list popups.
 *
 * Handles ArrowUp/ArrowDown (with wrap-around), Enter, and Tab key presses.
 * Syncs mouse hover with keyboard active index, auto-scrolls the active item
 * into view, and resets the index when items change.
 *
 * Usage:
 * ```tsx
 * const { activeIndex, handleKeyDown, optionsContainerRef, getItemProps } =
 *   useKeyboardListNavigation({ itemsLength: items.length, onSelect: (i) => select(items[i]) });
 *
 * <input onKeyDown={handleKeyDown} />
 * <div ref={optionsContainerRef}>
 *   {items.map((item, i) => {
 *     const { onMouseEnter, isActive } = getItemProps(i);
 *     return <button onMouseEnter={onMouseEnter} className={isActive ? '...' : '...'} />;
 *   })}
 * </div>
 * ```
 */
export function useKeyboardListNavigation({
  itemsLength,
  onSelect,
  enabled = true,
}: UseKeyboardListNavigationOptions): UseKeyboardListNavigationResult {
  const [activeIndex, setActiveIndex] = useState(0);
  const optionsContainerRef = useRef<HTMLDivElement>(null);

  // Reset active index when items change
  useEffect(() => {
    setActiveIndex(0);
  }, [itemsLength]);

  // Scroll active item into view
  useEffect(() => {
    if (!enabled || itemsLength === 0) return;
    const container = optionsContainerRef.current;
    if (!container) return;
    const activeButton = container.children[activeIndex] as HTMLElement | undefined;
    activeButton?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, itemsLength, enabled]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!enabled || itemsLength === 0) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((prev) => (prev < itemsLength - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : itemsLength - 1));
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < itemsLength) {
          onSelect(activeIndex);
        }
        break;
    }
  };

  const getItemProps = (index: number) => ({
    onMouseEnter: () => setActiveIndex(index),
    isActive: index === activeIndex,
  });

  return {
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    optionsContainerRef,
    getItemProps,
  };
}
