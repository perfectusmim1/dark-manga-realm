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

const normalizeText = (value?: string | null) => value?.trim() || undefined;
const normalizeMediaUrls = (values?: string[] | null) =>
  (values || []).map((value) => value.trim()).filter(Boolean);

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

export const commentHasRenderableContent = (payload: CommentContentPayload & { gifUrl?: string | null }) =>
  Boolean(
    stripCommentFormatting(payload.body).trim() ||
    payload.title?.trim() ||
    payload.mediaUrls?.some(Boolean) ||
    payload.mediaUrl?.trim() ||
    payload.gifUrl
  );

export const stripCommentFormatting = (value: string) =>
  value
    .replace(INLINE_FORMAT_REGEX, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "");

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
