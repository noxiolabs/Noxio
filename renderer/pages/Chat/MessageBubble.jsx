/**
 * @file MessageBubble.jsx
 * @description Renders a single chat message. User messages get a plain text
 * bubble; assistant messages are rendered as Markdown (via react-markdown +
 * remark-gfm) so code blocks, lists, bold, and tables display correctly.
 *
 * A blinking cursor is appended to the last assistant message while streaming.
 */

import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Syntax-highlighted code block for assistant messages.
 */
function CodeBlock({ children, className }) {
  const lang = (className ?? '').replace('language-', '') || 'text';
  return (
    <div className="my-2 rounded-lg overflow-hidden border border-zinc-700/50">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800/80 border-b border-zinc-700/50">
        <span className="text-[10px] text-zinc-500 font-mono">{lang}</span>
      </div>
      <pre className="p-3 overflow-x-auto bg-zinc-900/80 text-sm">
        <code className="text-zinc-200 font-mono text-[13px] leading-relaxed">{children}</code>
      </pre>
    </div>
  );
}

/** react-markdown component overrides for the dark theme. */
const MD_COMPONENTS = {
  code({ node, inline, className, children, ...props }) {
    if (inline) {
      return (
        <code className="px-1.5 py-0.5 rounded bg-zinc-800 text-violet-300 font-mono text-[13px]" {...props}>
          {children}
        </code>
      );
    }
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  p({ children }) {
    return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>;
  },
  ul({ children }) {
    return <ul className="mb-3 ml-4 list-disc space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-3 ml-4 list-decimal space-y-1">{children}</ol>;
  },
  li({ children }) {
    return <li className="text-zinc-300">{children}</li>;
  },
  h1({ children }) { return <h1 className="text-xl font-semibold text-white mt-4 mb-2">{children}</h1>; },
  h2({ children }) { return <h2 className="text-lg font-semibold text-white mt-4 mb-2">{children}</h2>; },
  h3({ children }) { return <h3 className="text-base font-semibold text-zinc-200 mt-3 mb-1">{children}</h3>; },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-violet-500/50 pl-3 my-2 text-zinc-400 italic">
        {children}
      </blockquote>
    );
  },
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="text-violet-400 underline underline-offset-2 hover:text-violet-300">
        {children}
      </a>
    );
  },
  hr() {
    return <hr className="my-4 border-zinc-700" />;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="text-sm border-collapse w-full">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="border border-zinc-700 px-3 py-1.5 text-left text-zinc-200 bg-zinc-800/60 font-medium">{children}</th>;
  },
  td({ children }) {
    return <td className="border border-zinc-700 px-3 py-1.5 text-zinc-300">{children}</td>;
  },
};

/**
 * @param {{
 *   message: { id: string, role: 'user'|'assistant', content: string },
 *   isStreaming: boolean,
 * }} props
 */
export default function MessageBubble({ message, isStreaming }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end mb-4">
        <div className="max-w-[75%] px-4 py-2.5 rounded-2xl rounded-br-md bg-violet-600/20 border border-violet-600/30 text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex mb-4 gap-3">
      {/* Assistant avatar dot */}
      <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <div className="w-2 h-2 rounded-full bg-violet-500" />
      </div>

      <div className="flex-1 min-w-0 text-sm text-zinc-200">
        {message.content ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {message.content}
          </ReactMarkdown>
        ) : null}
        {isStreaming && (
          <span className="inline-block w-0.5 h-4 bg-violet-500 animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}
