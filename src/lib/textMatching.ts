const COMBINING_MARKS_PATTERN = /\p{M}+/gu;
const WHITESPACE_PATTERN = /\s+/g;

export const normalizeComparableText = (value?: unknown): string => (
  `${value ?? ''}`
    .replace(/\u0130/g, 'I')
    .replace(/\u0131/g, 'i')
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
    .toLowerCase()
);

export const normalizeLooseComparableText = (value?: unknown): string => (
  normalizeComparableText(value).replace(/[^a-z0-9]/g, '')
);
