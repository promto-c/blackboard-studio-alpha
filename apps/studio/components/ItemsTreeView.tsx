import React from 'react';
import { ScrollArea } from '@blackboard/ui';
import { TREE_GUIDE_STEP, type TreeGuideSegment } from '@/utils/treeGuides';
import { TREE_ROW_CONTENT_START } from '@/components/itemsTreeStyles';

export interface ItemsTreeDropIndicator {
  depth: number;
  top: number;
}

interface ItemsTreeViewProps {
  scrollViewportRef?: React.Ref<HTMLDivElement>;
  contentRef?: React.Ref<HTMLDivElement>;
  guideSegments?: readonly TreeGuideSegment[];
  dropIndicator?: ItemsTreeDropIndicator | null;
  contentStart?: number;
  contentStep?: number;
  containerClassName?: string;
  className?: string;
  contentClassName?: string;
  onBackgroundClick?: () => void;
  children: React.ReactNode;
}

const TREE_GUIDE_VERTICAL_CLASS =
  'pointer-events-none absolute w-px rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.14),rgba(255,255,255,0.05))]';
const TREE_GUIDE_HORIZONTAL_CLASS =
  'pointer-events-none absolute h-px rounded-full bg-white/[0.12]';

const ItemsTreeView: React.FC<ItemsTreeViewProps> = ({
  scrollViewportRef,
  contentRef,
  guideSegments = [],
  dropIndicator,
  contentStart = TREE_ROW_CONTENT_START,
  contentStep = TREE_GUIDE_STEP,
  containerClassName = 'flex-1 min-h-0',
  className = 'h-full overflow-y-auto px-1 py-1',
  contentClassName = 'relative',
  onBackgroundClick,
  children,
}) => {
  const handleClick = onBackgroundClick
    ? (event: React.MouseEvent<HTMLDivElement>) => {
        if (!(event.target as HTMLElement).closest('[data-tree-row]')) {
          onBackgroundClick();
        }
      }
    : undefined;

  return (
    <ScrollArea
      ref={scrollViewportRef}
      containerClassName={containerClassName}
      className={className}
      onClick={handleClick}
    >
      <div ref={contentRef} className={contentClassName}>
        {guideSegments.length > 0 ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
            {guideSegments.map((segment) =>
              segment.orientation === 'vertical' ? (
                <div
                  key={segment.key}
                  className={TREE_GUIDE_VERTICAL_CLASS}
                  style={{
                    left: `${segment.left}px`,
                    top: `${segment.top}px`,
                    height: `${segment.height}px`,
                  }}
                />
              ) : (
                <div
                  key={segment.key}
                  className={TREE_GUIDE_HORIZONTAL_CLASS}
                  style={{
                    left: `${segment.left}px`,
                    top: `${segment.top}px`,
                    transform: 'translateY(-50%)',
                    width: `${segment.width}px`,
                  }}
                />
              ),
            )}
          </div>
        ) : null}

        {dropIndicator ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute z-20"
            style={{
              left: `${contentStart + dropIndicator.depth * contentStep}px`,
              right: '8px',
              top: `${dropIndicator.top}px`,
              transform: 'translateY(-50%)',
            }}
          >
            <div className="relative h-px rounded-full bg-primary-400/80" />
            <div className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full border border-primary-300/80 bg-primary-200" />
          </div>
        ) : null}

        <div className="space-y-0.5">{children}</div>
      </div>
    </ScrollArea>
  );
};

export default ItemsTreeView;
