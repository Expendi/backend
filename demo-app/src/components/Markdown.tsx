/**
 * Lightweight Markdown renderer for AI chat messages.
 *
 * Supports: bold, italic, inline code, code blocks with language tags,
 * unordered/ordered lists, headings (h1-h3), links, horizontal rules,
 * and blockquotes. No external dependencies.
 *
 * Design decisions:
 * - We parse block-level first, then inline markup within each block.
 * - Code blocks are rendered with a copy button and language label.
 * - We avoid dangerouslySetInnerHTML — everything is React elements.
 */

import { useState, useCallback, type ReactNode } from "react";

/* ─── Inline parser ──────────────────────────────────────────────── */

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Regex handles: bold(**), italic(*/_), inline code(`), links [text](url)
  const inlineRe =
    /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*|_(.+?)_|`(.+?)`|\[([^\]]+)\]\(([^)]+)\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = inlineRe.exec(text)) !== null) {
    // Push text before this match
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    if (match[2]) {
      // bold + italic ***text***
      nodes.push(
        <strong key={key}>
          <em>{match[2]}</em>
        </strong>
      );
    } else if (match[3]) {
      // bold **text**
      nodes.push(<strong key={key}>{match[3]}</strong>);
    } else if (match[4]) {
      // italic *text*
      nodes.push(<em key={key}>{match[4]}</em>);
    } else if (match[5]) {
      // italic _text_
      nodes.push(<em key={key}>{match[5]}</em>);
    } else if (match[6]) {
      // inline code `text`
      nodes.push(
        <code key={key} className="md-inline-code">
          {match[6]}
        </code>
      );
    } else if (match[7] && match[8]) {
      // link [text](url)
      nodes.push(
        <a
          key={key}
          href={match[8]}
          target="_blank"
          rel="noopener noreferrer"
          className="md-link"
        >
          {match[7]}
        </a>
      );
    }

    key++;
    lastIndex = match.index + match[0].length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

/* ─── Code block component with copy ─────────────────────────────── */

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        {language && <span className="md-code-lang">{language}</span>}
        <button
          className="md-code-copy"
          onClick={handleCopy}
          title="Copy code"
          aria-label="Copy code to clipboard"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/* ─── Block-level parser ─────────────────────────────────────────── */

interface Block {
  type:
    | "paragraph"
    | "code"
    | "heading"
    | "ul"
    | "ol"
    | "blockquote"
    | "hr"
    | "table";
  content: string;
  language?: string;
  level?: number;
  items?: string[];
  rows?: string[][];
  alignments?: string[];
}

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const language = codeMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", content: codeLines.join("\n"), language });
      continue;
    }

    // Horizontal rule
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push({ type: "hr", content: "" });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        quoteLines.push(lines[i].slice(2));
        i++;
      }
      blocks.push({ type: "blockquote", content: quoteLines.join("\n") });
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ul", content: "", items });
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "ol", content: "", items });
      continue;
    }

    // Table: detect if current line looks like a table header row
    // A table header has at least one pipe character
    if (
      line.includes("|") &&
      i + 1 < lines.length &&
      /^\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1])
    ) {
      const tableRows: string[][] = [];
      const alignments: string[] = [];

      // Parse header
      const headerCells = line
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      tableRows.push(headerCells);

      // Parse separator to get alignments
      const sepLine = lines[i + 1];
      const sepCells = sepLine
        .split("|")
        .map((c) => c.trim())
        .filter((c) => c !== "");
      for (const cell of sepCells) {
        if (cell.startsWith(":") && cell.endsWith(":")) {
          alignments.push("center");
        } else if (cell.endsWith(":")) {
          alignments.push("right");
        } else {
          alignments.push("left");
        }
      }

      i += 2; // skip header + separator

      // Parse body rows
      while (i < lines.length && lines[i].includes("|")) {
        const cells = lines[i]
          .split("|")
          .map((c) => c.trim())
          .filter((c) => c !== "");
        tableRows.push(cells);
        i++;
      }

      blocks.push({
        type: "table",
        content: "",
        rows: tableRows,
        alignments,
      });
      continue;
    }

    // Empty line — skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith("# ") &&
      !lines[i].startsWith("## ") &&
      !lines[i].startsWith("### ") &&
      !lines[i].startsWith("> ") &&
      !/^[\s]*[-*+]\s+/.test(lines[i]) &&
      !/^[\s]*\d+[.)]\s+/.test(lines[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }

    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", content: paraLines.join("\n") });
    }
  }

  return blocks;
}

/* ─── Main component ─────────────────────────────────────────────── */

export function Markdown({ content }: { content: string }) {
  if (!content) return null;

  const blocks = parseBlocks(content);

  return (
    <div className="md-root">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "code":
            return (
              <CodeBlock
                key={i}
                language={block.language || ""}
                code={block.content}
              />
            );

          case "heading": {
            const Tag = `h${block.level}` as "h1" | "h2" | "h3";
            return (
              <Tag key={i} className={`md-heading md-h${block.level}`}>
                {parseInline(block.content)}
              </Tag>
            );
          }

          case "ul":
            return (
              <ul key={i} className="md-list md-ul">
                {block.items?.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ul>
            );

          case "ol":
            return (
              <ol key={i} className="md-list md-ol">
                {block.items?.map((item, j) => (
                  <li key={j}>{parseInline(item)}</li>
                ))}
              </ol>
            );

          case "blockquote":
            return (
              <blockquote key={i} className="md-blockquote">
                {parseInline(block.content)}
              </blockquote>
            );

          case "hr":
            return <hr key={i} className="md-hr" />;

          case "table":
            return (
              <div key={i} className="md-table-wrap">
                <table className="md-table">
                  <thead>
                    <tr>
                      {block.rows?.[0]?.map((cell, j) => (
                        <th
                          key={j}
                          style={{
                            textAlign:
                              (block.alignments?.[j] as
                                | "left"
                                | "center"
                                | "right") || "left",
                          }}
                        >
                          {parseInline(cell)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows?.slice(1).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            style={{
                              textAlign:
                                (block.alignments?.[ci] as
                                  | "left"
                                  | "center"
                                  | "right") || "left",
                            }}
                          >
                            {parseInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );

          case "paragraph":
          default:
            return (
              <p key={i} className="md-paragraph">
                {parseInline(block.content)}
              </p>
            );
        }
      })}
    </div>
  );
}
