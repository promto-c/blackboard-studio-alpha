import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownComponents: Components = {
  a: ({ children, ...props }) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="text-current underline decoration-current/40 underline-offset-2 hover:decoration-current"
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-current/35 pl-2 opacity-85">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.startsWith('language-');
    if (isBlock) {
      return (
        <code className={`${className} block whitespace-pre-wrap break-words text-[11px]`}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded border border-current/15 bg-black/20 px-1 py-0.5 font-mono text-[0.92em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded border border-current/15 bg-black/25 p-2">
      {children}
    </pre>
  ),
  h1: ({ children }) => <h1 className="mb-1 mt-2 text-sm font-semibold">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1 mt-2 text-sm font-semibold">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-xs font-semibold">{children}</h3>,
  hr: () => <hr className="my-2 border-current/15" />,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-current/15 bg-white/5 px-2 py-1 font-semibold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-current/15 px-2 py-1">{children}</td>,
};

export function MarkdownNote({ content, className = '' }: { content: string; className?: string }) {
  return (
    <div className={`min-w-0 break-words ${className}`}>
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
