import React, { useState, useEffect, useRef, useMemo } from 'react';
import { imageTools, adjustmentTools, effectTools } from '@/effects/effectRegistry';
import { ToolDefinition } from '@/effects/EffectDefinition';
import { usePreferences } from '@/state/preferencesContext';
import * as Icons from '@blackboard/icons';
import { ScrollArea } from '@blackboard/ui';

const ToolSection: React.FC<{
  title: string;
  tools: ToolDefinition[];
  selectedToolType: string | null;
}> = ({ title, tools, selectedToolType }) => {
  if (tools.length === 0) return null;

  return (
    <div className="space-y-1 animate-[fadeIn_200ms_ease-out]">
      <h3 className="px-1 text-xs font-semibold tracking-wide text-gray-400">{title}</h3>
      <div className="grid grid-cols-4 gap-1">
        {tools.map((tool) => (
          <div
            key={tool.type}
            id={`tool-wrapper-${tool.type}`}
            className={`relative rounded-md transition-all duration-150 ${
              selectedToolType === tool.type
                ? 'ring-1 ring-primary-500/80 '
                : 'ring-0 ring-transparent'
            }`}
          >
            {tool.ToolComponent ? <tool.ToolComponent /> : null}
          </div>
        ))}
      </div>
    </div>
  );
};

const ToolsTab: React.FC = () => {
  const { toolUsageCounts, enableToolSorting } = usePreferences();
  const [filter, setFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const sortTools = useMemo(
    () => (tools: ToolDefinition[]) => {
      if (!enableToolSorting) return tools;

      return [...tools].sort((a, b) => {
        const countA = toolUsageCounts[a.name] || 0;
        const countB = toolUsageCounts[b.name] || 0;
        // Sort descending by usage count
        return countB - countA;
      });
    },
    [toolUsageCounts, enableToolSorting],
  );

  const sortedImageTools = useMemo(() => sortTools(imageTools), [sortTools]);
  const sortedAdjustmentTools = useMemo(() => sortTools(adjustmentTools), [sortTools]);
  const sortedEffectTools = useMemo(() => sortTools(effectTools), [sortTools]);

  const getUsageCount = (tool: ToolDefinition) => toolUsageCounts[tool.name] || 0;

  const getSearchScore = (tool: ToolDefinition, lowerFilter: string) => {
    const lowerName = tool.name.toLowerCase();
    const lowerDescription = tool.description?.toLowerCase() ?? '';

    if (lowerName === lowerFilter) return 500;
    if (lowerName.startsWith(lowerFilter)) return 400;
    if (lowerName.split(/\s+/).some((word) => word.startsWith(lowerFilter))) return 300;
    if (lowerName.includes(lowerFilter)) return 200;
    if (lowerDescription.startsWith(lowerFilter)) return 100;
    if (lowerDescription.includes(lowerFilter)) return 50;
    return -1;
  };

  const filteredTools = useMemo(() => {
    if (!filter) return null;
    const lowerFilter = filter.toLowerCase();
    // When searching, rank direct name matches ahead of description matches.
    const allTools = [...imageTools, ...adjustmentTools, ...effectTools];
    return allTools
      .map((tool) => ({
        tool,
        score: getSearchScore(tool, lowerFilter),
        usageCount: getUsageCount(tool),
      }))
      .filter((entry) => entry.score >= 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (enableToolSorting && b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
        return a.tool.name.localeCompare(b.tool.name);
      })
      .map((entry) => entry.tool);
  }, [filter, toolUsageCounts, enableToolSorting]);

  // Flattened list for navigation logic (matches render order)
  const flatTools = useMemo(() => {
    if (filteredTools) return filteredTools;
    return [...sortedImageTools, ...sortedAdjustmentTools, ...sortedEffectTools];
  }, [filteredTools, sortedImageTools, sortedAdjustmentTools, sortedEffectTools]);

  const selectedTool = flatTools[selectedIndex] || null;
  // Only show selection highlight if the input is actively focused
  const activeToolType = isFocused && selectedTool ? selectedTool.type : null;

  // Reset selection when list changes (e.g. typing)
  useEffect(() => {
    setSelectedIndex(0);
  }, [flatTools]);

  const scrollToTool = (tool: ToolDefinition) => {
    const el = document.getElementById(`tool-wrapper-${tool.type}`);
    if (el) {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  };

  const getToolElement = (tool: ToolDefinition) =>
    document.getElementById(`tool-wrapper-${tool.type}`);

  const getNextIndexByDirection = (
    direction: 'left' | 'right' | 'up' | 'down',
    currentIndex: number,
  ) => {
    const currentTool = flatTools[currentIndex];
    const currentElement = currentTool ? getToolElement(currentTool) : null;

    if (!currentTool || !currentElement) {
      return currentIndex;
    }

    const currentRect = currentElement.getBoundingClientRect();
    const currentCenterX = currentRect.left + currentRect.width / 2;
    const currentCenterY = currentRect.top + currentRect.height / 2;

    let bestIndex = currentIndex;
    let bestPrimaryDistance = Number.POSITIVE_INFINITY;
    let bestSecondaryDistance = Number.POSITIVE_INFINITY;

    flatTools.forEach((tool, index) => {
      if (index === currentIndex) return;

      const element = getToolElement(tool);
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const deltaX = centerX - currentCenterX;
      const deltaY = centerY - currentCenterY;

      let isCandidate = false;
      let primaryDistance = 0;
      let secondaryDistance = 0;

      if (direction === 'left' && deltaX < 0) {
        isCandidate = true;
        primaryDistance = Math.abs(deltaX);
        secondaryDistance = Math.abs(deltaY);
      } else if (direction === 'right' && deltaX > 0) {
        isCandidate = true;
        primaryDistance = deltaX;
        secondaryDistance = Math.abs(deltaY);
      } else if (direction === 'up' && deltaY < 0) {
        isCandidate = true;
        primaryDistance = Math.abs(deltaY);
        secondaryDistance = Math.abs(deltaX);
      } else if (direction === 'down' && deltaY > 0) {
        isCandidate = true;
        primaryDistance = deltaY;
        secondaryDistance = Math.abs(deltaX);
      }

      if (!isCandidate) return;

      if (
        primaryDistance < bestPrimaryDistance ||
        (primaryDistance === bestPrimaryDistance && secondaryDistance < bestSecondaryDistance)
      ) {
        bestIndex = index;
        bestPrimaryDistance = primaryDistance;
        bestSecondaryDistance = secondaryDistance;
      }
    });

    return bestIndex;
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (flatTools.length === 0) return;

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = getNextIndexByDirection('right', prev);
        scrollToTool(flatTools[next]);
        return next;
      });
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = getNextIndexByDirection('left', prev);
        scrollToTool(flatTools[next]);
        return next;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = getNextIndexByDirection('down', prev);
        scrollToTool(flatTools[next]);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = getNextIndexByDirection('up', prev);
        scrollToTool(flatTools[next]);
        return next;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const tool = flatTools[selectedIndex];
      if (tool) {
        const btn = document.querySelector(
          `#tool-wrapper-${tool.type} button`,
        ) as HTMLButtonElement;
        if (btn) {
          btn.click();
        }
      }
    }
  };

  return (
    <ScrollArea ref={scrollContainerRef} fill axis="y">
      <div>
        {/* Search Bar */}
        <div className="sticky top-0 z-10 bg-gray-900/35 px-2 py-2 backdrop-blur-sm">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 flex items-center pl-2.5 text-gray-500 transition-colors pointer-events-none group-focus-within:text-primary-400">
              <Icons.MagnifyingGlass className="h-3.5 w-3.5" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              placeholder="Search tools..."
              className="block w-full rounded-md border border-gray-700/50 bg-gray-800/50 py-1.5 pr-7 pl-8 text-xs text-gray-200 placeholder-gray-500 transition-all focus:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-primary-500/80"
            />
            {filter && (
              <button
                onClick={() => {
                  setFilter('');
                  inputRef.current?.focus();
                }}
                className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 hover:text-white"
                title="Clear search"
                aria-label="Clear search"
              >
                <Icons.XMark className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tools List */}
        <div className="rounded-lg px-2 pb-2 space-y-3 scroll-smooth">
          {filter ? (
            // Filtered View (Flat List)
            filteredTools && filteredTools.length > 0 ? (
              <ToolSection
                title="Search Results"
                tools={filteredTools}
                selectedToolType={activeToolType}
              />
            ) : (
              <div className="py-8 text-center text-xs text-gray-500">
                No tools found matching "{filter}"
              </div>
            )
          ) : (
            // Default Categorized View
            <>
              <ToolSection
                title="Media"
                tools={sortedImageTools}
                selectedToolType={activeToolType}
              />
              <ToolSection
                title="Adjustments"
                tools={sortedAdjustmentTools}
                selectedToolType={activeToolType}
              />
              <ToolSection
                title="Effects"
                tools={sortedEffectTools}
                selectedToolType={activeToolType}
              />
            </>
          )}
        </div>
      </div>
    </ScrollArea>
  );
};

export default ToolsTab;
