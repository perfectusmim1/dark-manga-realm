import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { SERIES_LEGACY_REGEX, SERIES_MARKDOWN_REGEX } from '@/lib/commentContent';
import { cn } from '@/lib/utils';

const INLINE_SEGMENT_PATTERN = [
  '\\[c=(#[0-9a-fA-F]{6})\\]([\\s\\S]*?)\\[\\/c\\]',
  '\\[s=(sm|lg)\\]([\\s\\S]*?)\\[\\/s\\]',
  '\\|\\|([^|\\n]+?)\\|\\|',
  '\\*\\*([^\\n]+?)\\*\\*',
  '__([^\\n]+?)__',
  '(?<!\\*)\\*([^*\\n]+?)\\*(?!\\*)',
  SERIES_MARKDOWN_REGEX.source,
  SERIES_LEGACY_REGEX.source,
  '\\[([^\\]]+?)\\]\\((https?:\\/\\/[^\\s)]+)\\)',
  '(?<![\\w@])@([a-zA-Z0-9_.çğıöşüÇĞİÖŞÜ-]{2,32})',
  '(https?:\\/\\/[^\\s<]+)',
].join('|');

const createInlineSegmentRegex = () => new RegExp(INLINE_SEGMENT_PATTERN, 'g');
const MAX_INLINE_RICH_TEXT_DEPTH = 6;

const InlineSpoilerChip: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [revealed, setRevealed] = useState(false);

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        setRevealed((prev) => !prev);
      }}
      title={revealed ? 'Gizle' : 'Spoilerı görmek için tıkla'}
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 align-baseline text-[0.94em] transition-all cursor-pointer select-none',
        revealed
          ? 'bg-secondary/70 text-foreground'
          : 'bg-muted text-transparent hover:bg-muted/80 border border-border/60 [&>*]:opacity-0',
      )}
    >
      {revealed ? (
        <>
          <span>{children}</span>
          <EyeOff className="h-3 w-3 shrink-0 text-muted-foreground" />
        </>
      ) : (
        <span className="relative inline-flex items-center gap-1">
          <span className="blur-[5px] text-foreground select-none">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center text-[11px] font-medium text-muted-foreground opacity-100">
            <Eye className="mr-1 h-3 w-3" />
            Spoiler
          </span>
        </span>
      )}
    </button>
  );
};

export interface RichTextOptions {
  baseClassName?: string;
  resolveMentionHref?: (username: string) => string | undefined;
}

const renderInlineSegments = (
  text: string,
  keyPrefix: string,
  options?: RichTextOptions,
  depth = 0,
): React.ReactNode[] => {
  if (!text) return [];
  if (depth > MAX_INLINE_RICH_TEXT_DEPTH) {
    return [text];
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let matchIndex = 0;

  const inlineRegex = createInlineSegmentRegex();
  let match: RegExpExecArray | null;

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match[0].length === 0) {
      inlineRegex.lastIndex += 1;
      continue;
    }
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${matchIndex++}`;
    const [
      fullMatch,
      colorHex,
      colorBody,
      sizeCode,
      sizeBody,
      spoilerText,
      boldText,
      underlineText,
      italicText,
      seriesTitleMd,
      seriesIdMd,
      seriesIdLegacy,
      seriesTitleLegacy,
      linkLabel,
      linkHref,
      mentionUsername,
      rawUrl,
    ] = match;

    if (colorHex && colorBody !== undefined) {
      nodes.push(
        <span key={key} style={{ color: colorHex }}>
          {renderInlineSegments(colorBody, `${key}-c`, options, depth + 1)}
        </span>,
      );
    } else if (sizeCode && sizeBody !== undefined) {
      nodes.push(
        <span key={key} className={sizeCode === 'sm' ? 'text-xs' : 'text-[1.06em] font-medium'}>
          {renderInlineSegments(sizeBody, `${key}-s`, options, depth + 1)}
        </span>,
      );
    } else if (spoilerText !== undefined) {
      nodes.push(<InlineSpoilerChip key={key}>{spoilerText}</InlineSpoilerChip>);
    } else if (boldText !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-foreground">
          {renderInlineSegments(boldText, `${key}-b`, options, depth + 1)}
        </strong>,
      );
    } else if (underlineText !== undefined) {
      nodes.push(
        <span key={key} className="underline underline-offset-2 decoration-primary/70">
          {renderInlineSegments(underlineText, `${key}-u`, options, depth + 1)}
        </span>,
      );
    } else if (italicText !== undefined) {
      nodes.push(
        <em key={key} className="italic">
          {renderInlineSegments(italicText, `${key}-i`, options, depth + 1)}
        </em>,
      );
    } else if (seriesTitleMd && seriesIdMd) {
      nodes.push(
        <Link
          key={key}
          to={`/manga/${encodeURIComponent(seriesIdMd)}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.92em] font-medium text-primary transition-colors hover:bg-primary/20 hover:text-primary align-baseline"
        >
          <BookOpen className="h-3 w-3 shrink-0" />
          <span>{seriesTitleMd}</span>
        </Link>,
      );
    } else if (seriesIdLegacy && seriesTitleLegacy) {
      nodes.push(
        <Link
          key={key}
          to={`/manga/${encodeURIComponent(seriesIdLegacy)}`}
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.92em] font-medium text-primary transition-colors hover:bg-primary/20 hover:text-primary align-baseline"
        >
          <BookOpen className="h-3 w-3 shrink-0" />
          <span>{seriesTitleLegacy}</span>
        </Link>,
      );
    } else if (linkLabel && linkHref) {
      nodes.push(
        <a
          key={key}
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:text-primary/80 break-all"
        >
          <span>{linkLabel}</span>
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>,
      );
    } else if (mentionUsername) {
      const mentionHref = options?.resolveMentionHref?.(mentionUsername);
      if (mentionHref) {
        nodes.push(
          <Link
            key={key}
            to={mentionHref}
            onClick={(e) => e.stopPropagation()}
            className="font-medium text-sky-400 transition-colors hover:text-sky-300 hover:underline"
          >
            @{mentionUsername}
          </Link>,
        );
      } else {
        nodes.push(
          <span key={key} className="font-medium text-sky-400">
            @{mentionUsername}
          </span>,
        );
      }
    } else if (rawUrl) {
      nodes.push(
        <a
          key={key}
          href={rawUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
        >
          {rawUrl}
        </a>,
      );
    } else {
      nodes.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? nodes : [text];
};

/**
 * Safely renders rich comment, review, forum, and wall text without raw HTML injection.
 * Supports bold, italic, underline, inline click-to-reveal spoilers, lists, links, @mentions,
 * legacy color/size tags, and interactive `#Series` tags.
 */
export const renderRichContent = (rawText: string, options: RichTextOptions = {}): React.ReactNode => {
  const normalized = (rawText || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) {
    return null;
  }

  const lines = normalized.split('\n');
  const blocks: React.ReactNode[] = [];
  let listType: 'ul' | 'ol' | null = null;
  let listItems: string[] = [];

  const flushList = (keySuffix: number) => {
    if (!listType || listItems.length === 0) return;
    const Tag = listType;
    blocks.push(
      <Tag
        key={`list-${keySuffix}`}
        className={cn(
          'my-1.5 space-y-1 pl-5 text-[0.95em]',
          listType === 'ul' ? 'list-disc marker:text-muted-foreground' : 'list-decimal marker:text-muted-foreground',
        )}
      >
        {listItems.map((item, idx) => (
          <li key={`li-${keySuffix}-${idx}`} className="leading-relaxed">
            {renderInlineSegments(item, `li-${keySuffix}-${idx}`, options)}
          </li>
        ))}
      </Tag>,
    );
    listType = null;
    listItems = [];
  };

  lines.forEach((line, index) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);

    if (bulletMatch) {
      if (listType === 'ol') flushList(index);
      listType = 'ul';
      listItems.push(bulletMatch[1]);
      return;
    }

    if (orderedMatch) {
      if (listType === 'ul') flushList(index);
      listType = 'ol';
      listItems.push(orderedMatch[1]);
      return;
    }

    flushList(index);

    if (!line.trim()) {
      blocks.push(<div key={`gap-${index}`} className="h-1.5" />);
      return;
    }

    blocks.push(
      <p key={`p-${index}`} className={cn('leading-relaxed break-words', options.baseClassName)}>
        {renderInlineSegments(line, `line-${index}`, options)}
      </p>,
    );
  });

  flushList(lines.length);

  return <div className="space-y-1">{blocks}</div>;
};
