import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ForumRichContentProps {
  content: string;
  isSpoiler?: boolean;
  mentionUserIdByUsername?: Record<string, string>;
  className?: string;
}

const URL_TOKEN_REGEX = /(https?:\/\/[^\s<>"']+)/g;
const MENTION_TOKEN_REGEX = /(^|\s)(@[a-zA-Z0-9_.-]{2,32})/g;

const splitTrailingUrlPunctuation = (rawUrl: string): { url: string; trailing: string } => {
  let candidate = rawUrl;
  let trailing = '';

  while (candidate.length > 0) {
    const lastChar = candidate[candidate.length - 1];
    if ('.,!?;:'.includes(lastChar)) {
      trailing = lastChar + trailing;
      candidate = candidate.slice(0, -1);
      continue;
    }

    if (lastChar === ')') {
      const openCount = (candidate.match(/\(/g) || []).length;
      const closeCount = (candidate.match(/\)/g) || []).length;
      if (closeCount > openCount) {
        trailing = lastChar + trailing;
        candidate = candidate.slice(0, -1);
        continue;
      }
    }

    break;
  }

  return { url: candidate, trailing };
};

const toSafeExternalHref = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
};

const renderTextWithMentions = (
  text: string,
  mentionUserIdByUsername: Record<string, string> | undefined,
  keyPrefix: string,
): React.ReactNode[] => {
  if (!text) {
    return [];
  }

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  MENTION_TOKEN_REGEX.lastIndex = 0;

  while ((match = MENTION_TOKEN_REGEX.exec(text)) !== null) {
    const fullMatchIndex = match.index;
    const leadingWhitespace = match[1];
    const mentionToken = match[2];

    if (fullMatchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, fullMatchIndex));
    }

    if (leadingWhitespace) {
      nodes.push(leadingWhitespace);
    }

    const usernameKey = mentionToken.slice(1).toLowerCase();
    const userId = mentionUserIdByUsername?.[usernameKey];

    if (userId) {
      nodes.push(
        <Link
          key={`${keyPrefix}-mention-${fullMatchIndex}`}
          to={`/profile/${userId}`}
          className="font-medium text-primary hover:underline"
        >
          {mentionToken}
        </Link>,
      );
    } else {
      nodes.push(
        <span
          key={`${keyPrefix}-mention-${fullMatchIndex}`}
          className="font-medium text-foreground"
        >
          {mentionToken}
        </span>,
      );
    }

    lastIndex = fullMatchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
};

const renderRichParagraph = (
  content: string,
  mentionUserIdByUsername?: Record<string, string>,
): React.ReactNode[] => {
  if (!content) {
    return [];
  }

  const normalizedMentionMap = mentionUserIdByUsername
    ? Object.fromEntries(
        Object.entries(mentionUserIdByUsername).map(([key, value]) => [key.toLowerCase(), value]),
      )
    : undefined;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  URL_TOKEN_REGEX.lastIndex = 0;

  while ((match = URL_TOKEN_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...renderTextWithMentions(
          content.slice(lastIndex, match.index),
          normalizedMentionMap,
          `seg-${lastIndex}`,
        ),
      );
    }

    const { url, trailing } = splitTrailingUrlPunctuation(match[0]);
    const safeHref = toSafeExternalHref(url);

    if (safeHref) {
      nodes.push(
        <a
          key={`url-${match.index}`}
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-primary hover:underline"
        >
          {url}
        </a>,
      );
    } else {
      nodes.push(url);
    }

    if (trailing) {
      nodes.push(trailing);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    nodes.push(
      ...renderTextWithMentions(
        content.slice(lastIndex),
        normalizedMentionMap,
        `seg-${lastIndex}`,
      ),
    );
  }

  return nodes;
};

const ForumRichContent: React.FC<ForumRichContentProps> = ({
  content,
  isSpoiler = false,
  mentionUserIdByUsername,
  className,
}) => {
  const [isSpoilerVisible, setIsSpoilerVisible] = useState(false);

  const renderedNodes = React.useMemo(
    () => renderRichParagraph(content, mentionUserIdByUsername),
    [content, mentionUserIdByUsername],
  );

  if (!isSpoiler) {
    return (
      <div
        className={cn(
          'whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90 [overflow-wrap:anywhere]',
          className,
        )}
      >
        {renderedNodes}
      </div>
    );
  }

  return (
    <div className={cn('space-y-2.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-amber-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          Spoiler içerir
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            setIsSpoilerVisible((prev) => !prev);
          }}
          className="h-7 gap-1.5 border-amber-500/30 bg-background/60 px-2.5 text-xs text-amber-100 hover:bg-amber-500/20 hover:text-amber-50"
        >
          {isSpoilerVisible ? (
            <>
              <EyeOff className="h-3.5 w-3.5" />
              Gizle
            </>
          ) : (
            <>
              <Eye className="h-3.5 w-3.5" />
              Göster
            </>
          )}
        </Button>
      </div>

      <div
        aria-hidden={!isSpoilerVisible}
        className={cn(
          'whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90 transition-all duration-200 [overflow-wrap:anywhere]',
          !isSpoilerVisible && 'pointer-events-none select-none opacity-55 blur-sm',
        )}
      >
        {renderedNodes}
      </div>
    </div>
  );
};

export default ForumRichContent;
