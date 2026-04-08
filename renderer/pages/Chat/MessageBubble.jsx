/**
 * @file MessageBubble.jsx
 * @description Renders a single chat message. User messages get a plain text
 * bubble; assistant messages are rendered as Markdown (via react-markdown +
 * remark-gfm) so code blocks, lists, bold, and tables display correctly.
 *
 * Thinking mode: if the message has a `thinking` field (native Ollama think API)
 * or the content begins with a `<think>` block (DeepSeek R1 / older models),
 * a collapsible reasoning panel is rendered above the answer. It is expanded
 * while streaming and collapsed by default once the stream completes.
 *
 * A blinking cursor is appended to the last assistant message while streaming.
 */

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Splits content that embeds <think>...</think> tags into { thinkingText, answerText }.
 * Works during streaming (incomplete closing tag) and when the block is complete.
 * Returns null for thinkingText if no <think> block is present.
 *
 * @param {string} content
 * @returns {{ thinkingText: string|null, answerText: string }}
 */
function parseInlineThinking(content) {
  if (!content.startsWith('<think>')) return { thinkingText: null, answerText: content };
  const closeIdx = content.indexOf('</think>');
  if (closeIdx !== -1) {
    return {
      thinkingText: content.slice('<think>'.length, closeIdx).trim(),
      answerText: content.slice(closeIdx + '</think>'.length).trimStart(),
    };
  }
  // Closing tag not yet arrived — still inside the think block
  return { thinkingText: content.slice('<think>'.length), answerText: '' };
}

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
 * Collapsible thinking / reasoning block.
 *
 * @param {{ thinking: string, isStreaming: boolean }} props
 */
function ThinkingBlock({ thinking, isStreaming }) {
  // Expanded while streaming; collapsed once the response is done.
  const [open, setOpen] = useState(isStreaming);

  // Auto-collapse when streaming finishes
  useEffect(() => {
    if (!isStreaming) setOpen(false);
  }, [isStreaming]);

  if (!thinking) return null;

  return (
    <div className="mb-3 rounded-lg border border-zinc-700/50 bg-zinc-900/60 overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/40 transition-colors"
      >
        <BrainIcon />
        <span className="flex-1">
          {isStreaming ? 'Thinking…' : 'View thinking'}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="px-3 pb-3 pt-0.5 text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap border-t border-zinc-800/60">
          {thinking}
          {isStreaming && (
            <span className="inline-block w-0.5 h-3 bg-zinc-600 animate-pulse ml-0.5 align-middle" />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * @param {{
 *   message: { id: string, role: 'user'|'assistant', content: string, thinking?: string },
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

  // Resolve thinking content: prefer native field, fall back to <think> tags in content
  const nativeThinking = message.thinking ?? '';
  const { thinkingText: inlineThinking, answerText } = nativeThinking
    ? { thinkingText: null, answerText: message.content }
    : parseInlineThinking(message.content ?? '');

  const thinkingText = nativeThinking || inlineThinking || '';
  const displayContent = nativeThinking ? (message.content ?? '') : answerText;

  // While thinking is still streaming and no answer tokens yet, show the cursor
  // inside the thinking block rather than below an empty answer area.
  const isThinkingPhase = isStreaming && !displayContent && !!thinkingText;

  return (
    <div className="flex mb-4 gap-3">
      {/* Assistant avatar dot */}
      <div className="w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <div className="w-2 h-2 rounded-full bg-violet-500" />
      </div>

      <div className="flex-1 min-w-0 text-sm text-zinc-200">
        {thinkingText && (
          <ThinkingBlock thinking={thinkingText} isStreaming={isStreaming && isThinkingPhase} />
        )}

        {displayContent ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
            {displayContent}
          </ReactMarkdown>
        ) : null}

        {isStreaming && !isThinkingPhase && (
          <span className="inline-block w-0.5 h-4 bg-violet-500 animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}

// ─── Inline icons ─────────────────────────────────────────────────────────────

function BrainIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-1.66Z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-1.66Z" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
