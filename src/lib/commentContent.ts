export interface CommentContentPayload {
  body: string;
  title?: string;
  textColor?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  isSpoiler?: boolean;
}

const COMMENT_CONTENT_PREFIX = "__TOONPARROT_COMMENT_V2__";
const INLINE_FORMAT_REGEX = /\[(?:c=#[0-9a-fA-F]{6}|s=(?:sm|lg)|\/c|\/s)\]/g;

/** Canonical markdown token for tagged series links: `[#Series Title](#series:manga_id)` */
export const SERIES_MARKDOWN_REGEX = /\[#([^\]]+?)\]\(#series:([A-Za-z0-9_-]+)\)/g;
/** Legacy/alternate token format `[#series:manga_id:Series Title]` */
export const SERIES_LEGACY_REGEX = /\[#series:([A-Za-z0-9_-]+):([^\]]+?)\]/g;

const normalizeText = (value?: string | null) => value?.trim() || undefined;
const normalizeMediaUrls = (values?: string[] | null) =>
  (values || []).map((value) => value.trim()).filter(Boolean);

export const formatSeriesMentionToken = (mangaId: string, title: string): string => {
  const safeTitle = title.replace(/[\[\]]/g, "").trim() || mangaId;
  return `[#${safeTitle}](#series:${mangaId})`;
};

export const parseCommentContent = (rawContent: string): CommentContentPayload => {
  if (!rawContent.startsWith(COMMENT_CONTENT_PREFIX)) {
    return { body: rawContent };
  }

  try {
    const parsed = JSON.parse(rawContent.slice(COMMENT_CONTENT_PREFIX.length)) as CommentContentPayload;

    return {
      body: parsed.body || "",
      title: normalizeText(parsed.title),
      textColor: normalizeText(parsed.textColor),
      mediaUrl: normalizeText(parsed.mediaUrl),
      mediaUrls: normalizeMediaUrls(parsed.mediaUrls).length
        ? normalizeMediaUrls(parsed.mediaUrls)
        : (normalizeText(parsed.mediaUrl) ? [normalizeText(parsed.mediaUrl)!] : []),
      isSpoiler: Boolean(parsed.isSpoiler),
    };
  } catch {
    return { body: rawContent };
  }
};

export const encodeCommentContent = (payload: CommentContentPayload): string => {
  const normalizedPayload: CommentContentPayload = {
    body: payload.body.trim(),
    title: normalizeText(payload.title),
    textColor: normalizeText(payload.textColor),
    mediaUrl: normalizeText(payload.mediaUrl),
    mediaUrls: normalizeMediaUrls(payload.mediaUrls),
    isSpoiler: Boolean(payload.isSpoiler),
  };

  if (!normalizedPayload.mediaUrl && normalizedPayload.mediaUrls?.length) {
    normalizedPayload.mediaUrl = normalizedPayload.mediaUrls[0];
  }

  const hasRichFields = Boolean(
    normalizedPayload.title ||
      normalizedPayload.textColor ||
      normalizedPayload.mediaUrls?.length ||
      normalizedPayload.isSpoiler
  );

  if (!hasRichFields) {
    return normalizedPayload.body;
  }

  return `${COMMENT_CONTENT_PREFIX}${JSON.stringify(normalizedPayload)}`;
};

export const stripCommentFormatting = (value: string) =>
  value
    .replace(SERIES_MARKDOWN_REGEX, "#$1")
    .replace(SERIES_LEGACY_REGEX, "#$2")
    .replace(INLINE_FORMAT_REGEX, "")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1")
    .replace(/\|\|([^|]+)\|\|/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");

export const commentHasRenderableContent = (payload: CommentContentPayload & { gifUrl?: string | null }) =>
  Boolean(
    stripCommentFormatting(payload.body).trim() ||
    payload.title?.trim() ||
    payload.mediaUrls?.some(Boolean) ||
    payload.mediaUrl?.trim() ||
    payload.gifUrl
  );

export const isValidCommentMediaUrl = (value: string) => {
  const trimmed = value.trim();

  if (!trimmed) {
    return true;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

export const isValidCommentMediaUrls = (values: string[]) => values.every(isValidCommentMediaUrl);

export interface TextareaWrapResult {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
}

/**
 * Wraps the currently selected range in a textarea (or inserts placeholder text)
 * with symmetrical markers such as `**`, `*`, `__`, or `||`.
 */
export const applyTextareaInlineWrap = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
  prefix: string,
  suffix: string = prefix,
  placeholder: string = "metin",
): TextareaWrapResult => {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
  const selected = value.slice(safeStart, safeEnd);
  const inner = selected || placeholder;
  const wrapped = `${prefix}${inner}${suffix}`;
  const nextValue = value.slice(0, safeStart) + wrapped + value.slice(safeEnd);

  return {
    nextValue,
    selectionStart: safeStart + prefix.length,
    selectionEnd: safeStart + prefix.length + inner.length,
  };
};

/**
 * Prefixes every selected line in a textarea with `- ` or numbered `1. ` markers.
 */
export const applyTextareaListPrefix = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
  ordered: boolean,
): TextareaWrapResult => {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length));
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length));
  const blockStart = value.lastIndexOf("\n", Math.max(0, safeStart - 1)) + 1;
  const nextNewline = value.indexOf("\n", safeEnd);
  const blockEnd = nextNewline === -1 ? value.length : nextNewline;

  const slice = value.slice(blockStart, blockEnd);
  const lines = slice ? slice.split("\n") : [""];
  const prefixed = lines
    .map((line, index) => {
      const cleaned = line.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, "");
      return `${ordered ? `${index + 1}. ` : "- "}${cleaned}`;
    })
    .join("\n");

  const nextValue = value.slice(0, blockStart) + prefixed + value.slice(blockEnd);
  return {
    nextValue,
    selectionStart: blockStart,
    selectionEnd: blockStart + prefixed.length,
  };
};

/**
 * Detects an active `#query` token immediately preceding the textarea caret.
 */
export const detectActiveSeriesTrigger = (
  value: string,
  caretIndex: number,
): { startIndex: number; endIndex: number; query: string } | null => {
  const safeCaret = Math.max(0, Math.min(caretIndex, value.length));
  const beforeCaret = value.slice(0, safeCaret);
  const match = beforeCaret.match(/(?:^|\s)#([^\s#\n]{0,40})$/);
  if (!match) {
    return null;
  }

  const hashOffset = beforeCaret.lastIndexOf("#");
  if (hashOffset < 0) {
    return null;
  }

  return {
    startIndex: hashOffset,
    endIndex: safeCaret,
    query: match[1] || "",
  };
};
