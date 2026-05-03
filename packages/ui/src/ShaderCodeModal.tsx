import React from 'react';
import CodeBlock from './CodeBlock';
import { XMark } from '@blackboard/icons';

interface ShaderCodeModalProps {
  title: string;
  code: string;
  onClose: () => void;
}

const ShaderCodeModal: React.FC<ShaderCodeModalProps> = ({ title, code, onClose }) => {
  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shader-code-modal-title"
    >
      <div
        className="bg-gray-900/80 backdrop-blur-lg border border-white/10 ring-1 ring-inset ring-white/10 rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col glass-component"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b border-gray-700/50">
          <h2 id="shader-code-modal-title" className="text-lg font-semibold text-white">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white transition-colors"
            aria-label="Close"
          >
            <XMark className="h-5 w-5" />
          </button>
        </div>
        <CodeBlock
          code={code}
          language="glsl"
          className="h-full overflow-auto"
          containerClassName="m-4 flex-1 min-h-0"
        />
      </div>
    </div>
  );
};

export default ShaderCodeModal;
