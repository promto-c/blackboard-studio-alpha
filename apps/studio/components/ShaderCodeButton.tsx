import { useState } from 'react';
import { ShaderCodeModal } from '@blackboard/ui';

interface ShaderCodeButtonProps {
  title: string;
  code: string;
}

/**
 * Reusable "View Code" button + modal for shader code display.
 *
 * Replaces the repeated pattern of:
 *   const [isCodeVisible, setIsCodeVisible] = useState(false);
 *   ... duplicated button JSX + ShaderCodeModal ...
 *
 * Usage:
 *   <ShaderCodeButton title={`${node.name} GLSL Code`} code={MY_SHADER} />
 */
export function ShaderCodeButton({ title, code }: ShaderCodeButtonProps) {
  const [isCodeVisible, setIsCodeVisible] = useState(false);

  return (
    <>
      <div className="mt-4 flex justify-end">
        <button
          onClick={() => setIsCodeVisible(true)}
          className="flex items-center gap-1 text-xs text-gray-400 transition-colors hover:text-primary-400"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3 w-3"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
            />
          </svg>
          View Code
        </button>
      </div>
      {isCodeVisible && (
        <ShaderCodeModal title={title} code={code} onClose={() => setIsCodeVisible(false)} />
      )}
    </>
  );
}
