import React, { useState, useEffect, useMemo } from 'react';
import * as Icons from '@blackboard/icons';

interface NewProjectViewProps {
  onBack: () => void;
  onCreate: (name: string, width: number, height: number) => void;
}

interface Preset {
  name: string;
  width: number;
  height: number;
}

const DEFAULT_PRESETS: Preset[] = [
  // Landscape Video & Monitors
  { name: 'HD (16:9)', width: 1920, height: 1080 },
  { name: '4K UHD (16:9)', width: 3840, height: 2160 },
  { name: 'Laptop (16:10)', width: 2560, height: 1600 },
  { name: 'Ultrawide (21:9)', width: 3440, height: 1440 },
  { name: 'Super Ultrawide (32:9)', width: 5120, height: 1440 },
  // Photography
  { name: 'Photo (3:2)', width: 3000, height: 2000 },
  // Square
  { name: 'Square (1:1)', width: 1080, height: 1080 },
  // Portrait
  { name: 'Story (9:16)', width: 1080, height: 1920 },
  // Print
  { name: 'A4 Paper', width: 2480, height: 3508 },
];

const CUSTOM_PRESETS_KEY = 'photo-editor-custom-presets-v1';

type PresetCategory = 'landscape' | 'portrait' | 'square';

const CategoryIcons: Record<PresetCategory, React.ReactNode> = {
  landscape: <Icons.Landscape className="h-4 w-4" />,
  portrait: <Icons.Portrait className="h-4 w-4" />,
  square: <Icons.Square className="h-4 w-4" />,
};

const PresetButton: React.FC<{
  preset: Preset;
  isSelected: boolean;
  onClick: () => void;
  onDelete?: () => void;
}> = ({ preset, isSelected, onClick, onDelete }) => {
  const aspectRatio = preset.width / preset.height;

  // Max dimension (width or height) for the thumbnail preview
  const MAX_DIM = 64; // 4rem or h-16
  let thumbWidth: number, thumbHeight: number;

  if (aspectRatio >= 1) {
    // Landscape or square
    thumbWidth = MAX_DIM;
    thumbHeight = MAX_DIM / aspectRatio;
  } else {
    // Portrait
    thumbHeight = MAX_DIM;
    thumbWidth = MAX_DIM * aspectRatio;
  }

  return (
    <button
      onClick={onClick}
      className={`relative group p-3 text-center w-full bg-gray-800 hover:bg-gray-700 rounded-lg transition-all duration-150 border flex flex-col items-center ${isSelected ? 'bg-primary-900/50 border-primary-500' : 'border-gray-700'}`}
    >
      <div className="flex justify-center items-center h-20 mb-3">
        <div
          className="bg-gray-600/70 rounded-sm"
          style={{
            width: `${thumbWidth}px`,
            height: `${thumbHeight}px`,
          }}
        />
      </div>

      <div className="w-full">
        <p className="font-semibold text-sm text-white truncate">{preset.name}</p>
        <p className="text-xs text-gray-400 font-mono">
          {preset.width} x {preset.height}
        </p>
      </div>

      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="absolute top-1 right-1 p-1 rounded-full text-gray-500 hover:text-red-400 hover:bg-gray-600 opacity-0 group-hover:opacity-100 transition-opacity z-10"
          title={`Delete preset ${preset.name}`}
        >
          <Icons.XMark className="h-3 w-3" />
        </button>
      )}
    </button>
  );
};

const NewProjectView: React.FC<NewProjectViewProps> = ({ onBack, onCreate }) => {
  const [projectName, setProjectName] = useState('Untitled Project');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [customPresets, setCustomPresets] = useState<Preset[]>([]);
  const [activeCategory, setActiveCategory] = useState<PresetCategory>('landscape');

  useEffect(() => {
    try {
      const storedPresets = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (storedPresets) {
        setCustomPresets(JSON.parse(storedPresets));
      }
    } catch (error) {
      console.error('Failed to load custom presets:', error);
    }
  }, []);

  const selectedPresetName = useMemo(() => {
    const numWidth = parseInt(width, 10);
    const numHeight = parseInt(height, 10);
    if (isNaN(numWidth) || isNaN(numHeight)) return null;

    const allPresets = [...customPresets, ...DEFAULT_PRESETS];
    const matched = allPresets.find((p) => p.width === numWidth && p.height === numHeight);
    return matched ? matched.name : null;
  }, [width, height, customPresets]);

  const filterPresets = (presets: Preset[], category: PresetCategory) => {
    return presets.filter((p) => {
      if (category === 'landscape') return p.width > p.height;
      if (category === 'portrait') return p.width < p.height;
      if (category === 'square') return p.width === p.height;
      return false;
    });
  };

  const filteredCustomPresets = useMemo(
    () => filterPresets(customPresets, activeCategory),
    [customPresets, activeCategory],
  );
  const filteredDefaultPresets = useMemo(
    () => filterPresets(DEFAULT_PRESETS, activeCategory),
    [activeCategory],
  );

  const handlePresetClick = (preset: Preset) => {
    setWidth(String(preset.width));
    setHeight(String(preset.height));
  };

  const handleSavePreset = () => {
    const numWidth = parseInt(width, 10);
    const numHeight = parseInt(height, 10);
    if (numWidth > 0 && numHeight > 0) {
      const newPreset: Preset = {
        name: `${numWidth} x ${numHeight}`,
        width: numWidth,
        height: numHeight,
      };
      if (customPresets.some((p) => p.name === newPreset.name)) return; // Avoid duplicates

      const newCustomPresets = [...customPresets, newPreset];
      setCustomPresets(newCustomPresets);
      localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(newCustomPresets));
    }
  };

  const handleDeletePreset = (presetNameToDelete: string) => {
    const newCustomPresets = customPresets.filter((p) => p.name !== presetNameToDelete);
    setCustomPresets(newCustomPresets);
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(newCustomPresets));
  };

  const handleCreate = () => {
    const numericWidth = parseInt(width, 10);
    const numericHeight = parseInt(height, 10);
    if (projectName.trim() && numericWidth > 0 && numericHeight > 0) {
      onCreate(projectName.trim(), numericWidth, numericHeight);
    }
  };

  const isValid =
    projectName.trim().length > 0 && parseInt(width, 10) > 0 && parseInt(height, 10) > 0;
  const canSavePreset = useMemo(() => {
    const numWidth = parseInt(width, 10);
    const numHeight = parseInt(height, 10);
    if (!(numWidth > 0 && numHeight > 0)) return false;
    const presetName = `${numWidth} x ${numHeight}`;
    return ![...customPresets, ...DEFAULT_PRESETS].some(
      (p) => p.name === presetName || (p.width === numWidth && p.height === numHeight),
    );
  }, [width, height, customPresets]);

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="relative text-center mb-8">
        <button
          onClick={onBack}
          className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1 text-sm text-gray-400 hover:text-white transition-colors p-2 -ml-2"
        >
          <Icons.ChevronLeft className="h-4 w-4" />
          Back
        </button>
        <h1 className="text-3xl font-bold text-white">Create New Project</h1>
      </div>

      <div className="bg-gray-800/50 rounded-lg p-6 space-y-6">
        <div className="space-y-2">
          <label htmlFor="projectName" className="text-sm font-medium text-gray-300">
            Project Name
          </label>
          <input
            type="text"
            id="projectName"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-2.5"
            placeholder="e.g., My Awesome Composite"
          />
        </div>

        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-2">
            <label htmlFor="projectWidth" className="text-sm font-medium text-gray-300">
              Width
            </label>
            <input
              type="number"
              id="projectWidth"
              value={width}
              onChange={(e) => setWidth(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-2.5"
              placeholder="1920"
              min="1"
            />
          </div>
          <div className="text-gray-500 pb-2.5">x</div>
          <div className="flex-1 space-y-2">
            <label htmlFor="projectHeight" className="text-sm font-medium text-gray-300">
              Height
            </label>
            <input
              type="number"
              id="projectHeight"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
              className="w-full bg-gray-700 border border-gray-600 text-gray-200 text-sm rounded-md focus:ring-primary-500 focus:border-primary-500 block p-2.5"
              placeholder="1080"
              min="1"
            />
          </div>
          <button
            onClick={handleSavePreset}
            disabled={!canSavePreset}
            title={
              canSavePreset
                ? 'Save current dimensions as a preset'
                : 'These dimensions are already a preset'
            }
            className="p-2.5 bg-gray-700 text-gray-300 rounded-md hover:bg-gray-600 hover:text-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Icons.Star className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-center gap-2 p-1 bg-gray-700/50 rounded-full">
            {(['landscape', 'portrait', 'square'] as PresetCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${activeCategory === cat ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-white'}`}
              >
                {CategoryIcons[cat]}
                <span className="capitalize">{cat}</span>
              </button>
            ))}
          </div>

          <div key={activeCategory} className="space-y-4 animate-[fadeIn_200ms_ease-out]">
            {filteredCustomPresets.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">My Presets</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredCustomPresets.map((p) => (
                    <PresetButton
                      key={p.name}
                      preset={p}
                      isSelected={p.name === selectedPresetName}
                      onClick={() => handlePresetClick(p)}
                      onDelete={() => handleDeletePreset(p.name)}
                    />
                  ))}
                </div>
              </div>
            )}

            {filteredDefaultPresets.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-gray-300">Default Presets</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {filteredDefaultPresets.map((p) => (
                    <PresetButton
                      key={p.name}
                      preset={p}
                      isSelected={p.name === selectedPresetName}
                      onClick={() => handlePresetClick(p)}
                    />
                  ))}
                </div>
              </div>
            )}
            {filteredCustomPresets.length === 0 && filteredDefaultPresets.length === 0 && (
              <div className="text-center text-gray-500 text-sm py-8">
                No presets found for the '{activeCategory}' category.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end mt-6">
        <button
          onClick={handleCreate}
          disabled={!isValid}
          className="px-6 py-2.5 text-sm font-medium text-white bg-primary-600 rounded-md hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-opacity-75 transition disabled:bg-gray-500 disabled:cursor-not-allowed"
        >
          Create Project
        </button>
      </div>
    </div>
  );
};

export default NewProjectView;
