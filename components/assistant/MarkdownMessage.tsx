'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Markdown for assistant replies.
 *
 * The model answers in markdown — bulleted reasoning, bold figures, the odd table — and the
 * panel used to render it through `whitespace-pre-line`, so a table arrived as a wall of
 * pipes and every `**` was literal. This renders it properly.
 *
 * Styling is applied per element rather than with a prose plugin, because the density here is
 * a chat bubble in a viewport-height dashboard panel, not an article: headings are only
 * slightly larger than body text, and the first element has no top margin so a reply does not
 * start with a gap.
 *
 * `react-markdown` renders no raw HTML without an added rehype plugin, so model output cannot
 * inject markup. That matters more than usual here: this text is generated, not written.
 */

const MarkdownMessage = ({ content }: { content: string }) => (
    // [&>*:first-child]:mt-0 — markdown blocks all carry a top margin, and the first one
    // should not push the bubble open.
    <div className="space-y-2 text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
        <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
                p: ({ children }) => <p className="leading-relaxed">{children}</p>,

                // Headings stay close to body size: this is a chat reply, and a real H1 would
                // shout. They still carry the weight that makes the structure scannable.
                h1: ({ children }) => (
                    <h3 className="mt-3 text-[13px] font-semibold text-white">{children}</h3>
                ),
                h2: ({ children }) => (
                    <h3 className="mt-3 text-[13px] font-semibold text-white">{children}</h3>
                ),
                h3: ({ children }) => (
                    <h4 className="mt-3 text-[12px] font-semibold text-gray-100">{children}</h4>
                ),
                h4: ({ children }) => (
                    <h4 className="mt-2 text-[12px] font-semibold text-gray-100">{children}</h4>
                ),

                ul: ({ children }) => (
                    <ul className="ml-4 list-disc space-y-1 marker:text-gray-600">{children}</ul>
                ),
                ol: ({ children }) => (
                    <ol className="ml-4 list-decimal space-y-1 marker:text-gray-500">{children}</ol>
                ),
                li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,

                strong: ({ children }) => (
                    <strong className="font-semibold text-white">{children}</strong>
                ),
                em: ({ children }) => <em className="italic text-gray-100">{children}</em>,

                a: ({ children, href }) => (
                    <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-teal-400 underline decoration-teal-800 underline-offset-2 hover:text-teal-300"
                    >
                        {children}
                    </a>
                ),

                // Figures are usually inline code in these answers, so it has to read as a
                // number rather than as code.
                code: ({ children }) => (
                    <code className="rounded bg-black/50 px-1 py-0.5 font-mono text-[12px] tabular-nums text-teal-200">
                        {children}
                    </code>
                ),
                pre: ({ children }) => (
                    <pre className="overflow-x-auto rounded-md border border-gray-800 bg-black/50 p-2.5 font-mono text-[12px] leading-relaxed">
                        {children}
                    </pre>
                ),

                blockquote: ({ children }) => (
                    <blockquote className="border-l-2 border-gray-700 pl-3 text-gray-400">
                        {children}
                    </blockquote>
                ),
                hr: () => <hr className="my-3 border-gray-800" />,

                // Tables are the one block that can outgrow the bubble, so they scroll
                // sideways rather than forcing the panel to.
                table: ({ children }) => (
                    <div className="overflow-x-auto rounded-md border border-gray-800">
                        <table className="w-full border-collapse text-[12px]">{children}</table>
                    </div>
                ),
                thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
                th: ({ children }) => (
                    <th className="border-b border-gray-700 px-2 py-1.5 text-left font-medium text-gray-300">
                        {children}
                    </th>
                ),
                td: ({ children }) => (
                    <td className="border-b border-gray-800/60 px-2 py-1.5 tabular-nums text-gray-300 last:border-r-0">
                        {children}
                    </td>
                ),
            }}
        >
            {content}
        </ReactMarkdown>
    </div>
);

export default MarkdownMessage;
