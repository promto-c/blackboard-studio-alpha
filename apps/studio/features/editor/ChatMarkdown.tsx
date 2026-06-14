import React from 'react';
import { CodeBlock } from '@blackboard/ui';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownCodeElementProps = {
  children?: React.ReactNode;
  className?: string;
};

const getMarkdownPlainText = (children: React.ReactNode): string =>
  React.Children.toArray(children)
    .map((child) => {
      if (typeof child === 'string' || typeof child === 'number') {
        return String(child);
      }

      if (React.isValidElement<{ children?: React.ReactNode }>(child)) {
        return getMarkdownPlainText(child.props.children);
      }

      return '';
    })
    .join('');

const markdownComponents: Components = {
  a({ children, href, ...props }) {
    const isAnchorLink = href?.startsWith('#') ?? false;

    return (
      <a
        {...props}
        href={href}
        target={isAnchorLink ? undefined : '_blank'}
        rel={isAnchorLink ? undefined : 'noreferrer'}
        className="font-medium text-primary-200 underline decoration-primary-300/40 underline-offset-2 transition hover:text-primary-100"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="my-2 border-l-2 border-primary-300/35 pl-3 text-gray-300">
        {children}
      </blockquote>
    );
  },
  code({ children, className, node: _node, ...props }) {
    return (
      <code
        {...props}
        className={`rounded border border-white/10 bg-black/25 px-1 py-0.5 font-mono text-[12px] text-gray-100 ${
          className ?? ''
        }`}
      >
        {children}
      </code>
    );
  },
  del({ children }) {
    return <del className="text-gray-400 decoration-gray-500">{children}</del>;
  },
  h1({ children }) {
    return <h1 className="mb-2 mt-3 text-base font-semibold leading-6 text-white">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="mb-2 mt-3 text-sm font-semibold leading-5 text-white">{children}</h2>;
  },
  h3({ children }) {
    return (
      <h3 className="mb-1.5 mt-2.5 text-[13px] font-semibold leading-5 text-white">{children}</h3>
    );
  },
  h4({ children }) {
    return (
      <h4 className="mb-1 mt-2 text-[13px] font-medium leading-5 text-gray-100">{children}</h4>
    );
  },
  h5({ children }) {
    return <h5 className="mb-1 mt-2 text-xs font-medium leading-5 text-gray-100">{children}</h5>;
  },
  h6({ children }) {
    return <h6 className="mb-1 mt-2 text-xs font-medium leading-5 text-gray-300">{children}</h6>;
  },
  hr() {
    return <hr className="my-3 border-white/10" />;
  },
  img({ alt, ...props }) {
    return (
      <img
        {...props}
        alt={alt ?? ''}
        className="my-2 max-h-64 max-w-full rounded-md border border-white/10 object-contain"
        loading="lazy"
      />
    );
  },
  input(props) {
    return (
      <input {...props} className="mr-1.5 h-3.5 w-3.5 align-[-2px] accent-primary-500" readOnly />
    );
  },
  li({ children }) {
    return <li className="pl-1 leading-5">{children}</li>;
  },
  ol({ children }) {
    return <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>;
  },
  p({ children }) {
    return <p className="my-2 whitespace-pre-wrap leading-5 first:mt-0 last:mb-0">{children}</p>;
  },
  pre({ children }) {
    const codeElement = React.Children.toArray(children).find((child) =>
      React.isValidElement<MarkdownCodeElementProps>(child),
    );

    if (React.isValidElement<MarkdownCodeElementProps>(codeElement)) {
      const language = /language-([A-Za-z0-9_+#.-]+)/.exec(codeElement.props.className ?? '')?.[1];

      return (
        <CodeBlock
          code={getMarkdownPlainText(codeElement.props.children).replace(/\n$/, '')}
          language={language}
          className="max-h-72 overflow-auto"
        />
      );
    }

    return (
      <pre className="my-2 overflow-auto rounded-md border border-white/10 bg-gray-950/80 p-3 text-[13px] text-gray-100">
        {children}
      </pre>
    );
  },
  strong({ children }) {
    return <strong className="font-semibold text-white">{children}</strong>;
  },
  table({ children }) {
    return (
      <div className="my-2 overflow-auto rounded-md border border-white/10">
        <table className="min-w-full border-collapse text-left text-[12px]">{children}</table>
      </div>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-white/10">{children}</tbody>;
  },
  td({ children }) {
    return (
      <td className="border-r border-white/10 px-2 py-1.5 text-gray-200 last:border-r-0">
        {children}
      </td>
    );
  },
  th({ children }) {
    return (
      <th className="border-r border-white/10 bg-white/[0.04] px-2 py-1.5 font-semibold text-gray-100 last:border-r-0">
        {children}
      </th>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-white/10">{children}</thead>;
  },
  ul({ children }) {
    return <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>;
  },
};

function ChatMarkdown({ content, className }: { content: string; className?: string }) {
  return (
    <div
      data-selectable-text
      className={`mt-2 min-w-0 text-[13px] leading-5 text-gray-100 ${className ?? ''}`}
    >
      <ReactMarkdown components={markdownComponents} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default ChatMarkdown;
