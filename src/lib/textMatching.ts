const COMBINING_MARKS_PATTERN = /\p{M}+/gu;
const WHITESPACE_PATTERN = /\s+/g;
const NON_PRINTABLE_ASCII_PATTERN = /[^\u0020-\u007e]/;
const NON_LOWER_ALNUM_PATTERN = /[^a-z0-9]/;
const NON_LOWER_ALNUM_GLOBAL_PATTERN = /[^a-z0-9]/g;

export const normalizeComparableText = (value?: unknown): string => {
  const raw = typeof value === 'string' ? value : value == null ? '' : `${value}`;
  if (!raw) {
    return '';
  }

  if (!NON_PRINTABLE_ASCII_PATTERN.test(raw)) {
    const trimmed = raw.trim();
    if (!trimmed) {
      return '';
    }
    const collapsed = trimmed.includes('  ')
      ? trimmed.replace(WHITESPACE_PATTERN, ' ')
      : trimmed;
    return collapsed.toLowerCase();
  }

  return raw
    .replace(/\u0130/g, 'I')
    .replace(/\u0131/g, 'i')
    .normalize('NFKD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
    .toLowerCase();
};

export const normalizeLooseComparableText = (value?: unknown): string => {
  const normalized = normalizeComparableText(value);
  if (!normalized || !NON_LOWER_ALNUM_PATTERN.test(normalized)) {
    return normalized;
  }
  return normalized.replace(NON_LOWER_ALNUM_GLOBAL_PATTERN, '');
};
