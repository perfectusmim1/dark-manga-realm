import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Eye, EyeOff } from 'lucide-react';
import {
  isForumImageUrl,
  splitTrailingUrlPunctuation,
  toSafeHttpUrl,
} from '@/lib/forumMedia';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ForumRichContentProps {
  content: string;
  isSpoiler?: boolean;
  mentionUserIdByUsername?: Record<string, string>;
  className?: string;
}

const COMBINED_MEDIA_OR_URL_REGEX = /(!\[[^\]]*\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+)/g;
const MARKDOWN_IMAGE_CAPTURE_REGEX = /^!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)$/;
const MENTION_TOKEN_REGEX = /(^|\s)(@[a-zA-Z0-9_.-]{2,32})/g;

interface InlineImageProps {
  src: string;
  alt: string;
}

const ForumInlineImage: React.FC<InlineImageProps> = ({ src, alt }) => {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={src}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-medium text-primary hover:underline"
      >
        {src}
      </a>
    );
  }

  return (
    <a
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      className="my-2 block w-fit max-w-full overflow-hidden rounded-xl border border-border/60 bg-background/40 transition-colors hover:border-primary/50"
      title="Tam boyutta aç"
    >
      <img
        src={src}
        alt={alt || 'Forum görseli'}
        loading="lazy"
        onError={() => setFailed(true)}
        className="max-h-[26rem] w-auto max-w-full object-contain"
      />
    </a>
  );
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
          className="font-medium text-sky-400 hover:text-sky-300 hover:underline"
        >
          {mentionToken}
        </Link>,
      );
    } else {
      nodes.push(
        <span
          key={`${keyPrefix}-mention-${fullMatchIndex}`}
          className="font-medium text-sky-400"
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
  COMBINED_MEDIA_OR_URL_REGEX.lastIndex = 0;

  while ((match = COMBINED_MEDIA_OR_URL_REGEX.exec(content)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...renderTextWithMentions(
          content.slice(lastIndex, match.index),
          normalizedMentionMap,
          `seg-${lastIndex}`,
        ),
      );
    }

    const rawToken = match[0];
    const markdownMatch = rawToken.match(MARKDOWN_IMAGE_CAPTURE_REGEX);

    if (markdownMatch) {
      const alt = markdownMatch[1]?.trim() || 'Forum görseli';
      const safeImgHref = toSafeHttpUrl(markdownMatch[2]);
      if (safeImgHref) {
        nodes.push(
          <ForumInlineImage
            key={`img-${match.index}`}
            src={safeImgHref}
            alt={alt}
          />,
        );
      } else {
        nodes.push(rawToken);
      }
      lastIndex = match.index + rawToken.length;
      continue;
    }

    const { url, trailing } = splitTrailingUrlPunctuation(rawToken);
    const safeHref = toSafeHttpUrl(url);

    if (safeHref && isForumImageUrl(safeHref)) {
      nodes.push(
        <ForumInlineImage
          key={`img-${match.index}`}
          src={safeHref}
          alt="Forum görseli"
        />,
      );
    } else if (safeHref) {
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

    lastIndex = match.index + rawToken.length;
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
