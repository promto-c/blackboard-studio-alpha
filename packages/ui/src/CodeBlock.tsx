import React from 'react';
import ScrollArea from './ScrollArea';
import { ensureCodeHighlightStyles, highlightCode } from './codeHighlighting';

export interface CodeBlockProps {
  code: string;
  onChange?: (value: string) => void;
  language?: string;
  readOnly?: boolean;
  className?: string;
  containerClassName?: string;
  fontSize?: number;
  showLineNumbers?: boolean;
  wordWrap?: boolean;
  spellCheck?: boolean;
}

const CONTENT_PADDING_CLASS = 'px-2 py-3';
const CODE_PRE_CLASS = `m-0 min-w-0 text-gray-100 ${CONTENT_PADDING_CLASS}`;

const CodeBlock: React.FC<CodeBlockProps> = ({
  code,
  onChange,
  language,
  readOnly,
  className = '',
  containerClassName = '',
  fontSize = 13,
  showLineNumbers = true,
  wordWrap = false,
  spellCheck = false,
}) => {
  const lineCount = React.useMemo(() => (code.match(/\n/g) || []).length + 1, [code]);
  const highlightedCode = React.useMemo(() => highlightCode(code, language), [code, language]);
  const resolvedReadOnly = readOnly ?? !onChange;
  const isEditable = !resolvedReadOnly && typeof onChange === 'function';

  const lineNumberDigits = React.useMemo(() => String(lineCount).length, [lineCount]);
  const lineNumberColumnWidth = React.useMemo(
    () => `${Math.max(3, lineNumberDigits)}ch`,
    [lineNumberDigits],
  );

  React.useEffect(() => {
    ensureCodeHighlightStyles();
  }, []);

  const sharedStyles = React.useMemo<React.CSSProperties & { MozTabSize?: number }>(
    () => ({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize,
      lineHeight: '1.5rem',
      whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
      wordBreak: wordWrap ? 'break-word' : 'normal',
      tabSize: 4,
      MozTabSize: 4,
    }),
    [fontSize, wordWrap],
  );

  return (
    <div
      data-text-selection-scope
      className={`overflow-hidden rounded-md border border-white/10 bg-gray-950/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${containerClassName}`}
    >
      <ScrollArea axis="both" viewportClassName={className}>
        <div className={`relative flex ${wordWrap ? 'min-w-full' : 'w-max min-w-full'}`}>
          {/* Line numbers column */}
          {showLineNumbers && (
            <div
              aria-hidden="true"
              className={`pl-4 sticky rounded-l-md left-0 z-10 w-${lineNumberColumnWidth} shrink-0 select-none border-r border-white/10 bg-gray-950/45 text-right text-[11px] leading-6 text-gray-500 backdrop-blur-md ${CONTENT_PADDING_CLASS}`}
              style={sharedStyles}
            >
              {Array.from({ length: lineCount }, (_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
          )}

          {/* Code content */}
          {isEditable ? (
            <div className="relative min-w-0">
              <pre
                aria-hidden="true"
                data-selectable-text
                className={CODE_PRE_CLASS}
                style={sharedStyles}
              >
                <code
                  className="bb-code-token-root"
                  dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
                />
              </pre>
              <textarea
                value={code}
                onChange={(event) => onChange(event.target.value)}
                readOnly={resolvedReadOnly}
                spellCheck={spellCheck}
                wrap={wordWrap ? 'soft' : 'off'}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                data-selectable-text
                className={`absolute inset-0 resize-none overflow-hidden bg-transparent text-transparent focus:outline-none ${CONTENT_PADDING_CLASS}`}
                style={{
                  ...sharedStyles,
                  caretColor: 'rgb(var(--color-primary-400))',
                }}
              />
            </div>
          ) : (
            <pre data-selectable-text className={CODE_PRE_CLASS} style={sharedStyles}>
              <code
                className="bb-code-token-root"
                dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
              />
            </pre>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default CodeBlock;
