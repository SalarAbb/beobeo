"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Assistant-message markdown: GFM tables, tight spacing, theme-aware. */
export function ChatMarkdown({ children }: { children: string }) {
  return (
    <div className="chat-md text-sm [&>*+*]:mt-2">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: (props) => (
            <div className="overflow-x-auto">
              <table
                className="my-1 w-full border-collapse text-xs"
                {...props}
              />
            </div>
          ),
          th: (props) => (
            <th
              className="border-b border-border px-2 py-1 text-left font-semibold"
              {...props}
            />
          ),
          td: (props) => (
            <td className="border-b border-border/50 px-2 py-1 data" {...props} />
          ),
          ul: (props) => <ul className="list-disc pl-5" {...props} />,
          ol: (props) => <ol className="list-decimal pl-5" {...props} />,
          a: (props) => <a className="underline" target="_blank" rel="noreferrer" {...props} />,
          code: (props) => (
            <code className="rounded bg-background/60 px-1 font-mono text-[0.85em]" {...props} />
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
