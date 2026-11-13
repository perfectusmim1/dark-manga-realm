const MARKDOWN_IMAGE_REGEX = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g;
const URL_TOKEN_REGEX = /(https?:\/\/[^\s<>"']+)/g;

const IMAGE_EXTENSION_REGEX = /\.(?:png|jpe?g|webp|gif|avif|bmp|svg)(?:$|[?#])/i;

const KNOWN_IMAGE_HOSTS = new Set([
  'media.tenor.com',
  'c.tenor.com',
  'i.giphy.com',
  'i.imgur.com',
  'pbs.twimg.com',
  'cdn.discordapp.com',
  'media.discordapp.net',
  'images.unsplash.com',
]);

export const splitTrailingUrlPunctuation = (
  rawUrl: string,
): { url: string; trailing: string } => {
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

export const toSafeHttpUrl = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
};

export const isForumImageUrl = (rawUrl: string): boolean => {
  const safe = toSafeHttpUrl(rawUrl);
  if (!safe) {
    return false;
  }

  try {
    const parsed = new URL(safe);
    if (IMAGE_EXTENSION_REGEX.test(`${parsed.pathname}${parsed.search}`)) {
      return true;
    }

    const host = parsed.hostname.toLowerCase();
    if (KNOWN_IMAGE_HOSTS.has(host) || /^media\d*\.giphy\.com$/.test(host)) {
      return true;
    }

    const formatParam = parsed.searchParams.get('format')?.toLowerCase();
    if (
      formatParam &&
      ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(formatParam)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
};

export const splitForumTextAndMedia = (
  rawContent: string,
): { body: string; mediaUrls: string[] } => {
  if (!rawContent) {
    return { body: '', mediaUrls: [] };
  }

  const foundUrls: string[] = [];
  const seenUrls = new Set<string>();
  const addMediaUrl = (candidate: string) => {
    const safe = toSafeHttpUrl(candidate);
    if (!safe || seenUrls.has(safe)) {
      return;
    }
    seenUrls.add(safe);
    foundUrls.push(safe);
  };

  let remaining = rawContent.replace(
    MARKDOWN_IMAGE_REGEX,
    (_fullMatch, _alt, url: string) => {
      addMediaUrl(url);
      return '';
    },
  );

  const lines = remaining.split(/\r?\n/);
  const keptLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      keptLines.push(line);
      continue;
    }

    const singleSafeUrl = !/\s/.test(trimmed) ? toSafeHttpUrl(trimmed) : null;
    if (singleSafeUrl && isForumImageUrl(singleSafeUrl)) {
      addMediaUrl(singleSafeUrl);
      continue;
    }

    keptLines.push(line);
  }

  remaining = keptLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    body: remaining,
    mediaUrls: foundUrls,
  };
};

export const mergeForumTextAndMedia = (
  body: string,
  mediaUrls: string[],
): string => {
  const trimmedBody = body.trim();
  const uniqueValidMedia: string[] = [];
  const seen = new Set<string>();

  for (const rawUrl of mediaUrls) {
    const trimmedUrl = rawUrl.trim();
    if (!trimmedUrl) {
      continue;
    }
    const safe = toSafeHttpUrl(trimmedUrl);
    if (!safe) {
      continue;
    }
    if (!seen.has(safe) && !trimmedBody.includes(safe)) {
      seen.add(safe);
      uniqueValidMedia.push(safe);
    }
  }

  if (uniqueValidMedia.length === 0) {
    return trimmedBody;
  }

  const formattedMedia = uniqueValidMedia.map((url) =>
    isForumImageUrl(url) ? url : `![Görsel](${url})`,
  );

  if (!trimmedBody) {
    return formattedMedia.join('\n');
  }

  return `${trimmedBody}\n\n${formattedMedia.join('\n')}`;
};

export const validateForumMediaUrls = (mediaUrls: string[]): boolean =>
  mediaUrls.every((raw) => {
    const trimmed = raw.trim();
    return !trimmed || Boolean(toSafeHttpUrl(trimmed));
  });

export const stripForumMediaForPreview = (
  rawContent: string,
): { text: string; mediaCount: number } => {
  if (!rawContent) {
    return { text: '', mediaCount: 0 };
  }

  let mediaCount = 0;
  let cleaned = rawContent.replace(MARKDOWN_IMAGE_REGEX, () => {
    mediaCount += 1;
    return ' ';
  });

  URL_TOKEN_REGEX.lastIndex = 0;
  cleaned = cleaned.replace(URL_TOKEN_REGEX, (match) => {
    const { url, trailing } = splitTrailingUrlPunctuation(match);
    if (isForumImageUrl(url)) {
      mediaCount += 1;
      return trailing;
    }
    return match;
  });

  return {
    text: cleaned.replace(/\s+/g, ' ').trim(),
    mediaCount,
  };
};
