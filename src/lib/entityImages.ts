const normalizeText = (value?: string | null) => value?.replace(/\s+/g, ' ').trim() || '';

const MAL_PLACEHOLDER_PATTERNS = [
  /myanimelist\.net\/images\/questionmark/i,
  /myanimelist\.net\/images\/qm_/i,
  /myanimelist\.net\/images\/apple-touch-icon/i,
  /myanimelist\.net\/images\/touch-icon/i,
  /myanimelist\.net\/images\/android-chrome/i,
  /myanimelist\.net\/images\/favicon/i,
  /myanimelist\.net\/img\/sp\/icon/i,
  /myanimelist\.net\/img\/common\/logo/i,
  /cdn\.myanimelist\.net\/images\/questionmark/i,
  /cdn\.myanimelist\.net\/images\/qm_/i,
  /cdn\.anime-planet\.com\/images\/people\/default\/default-staff\.svg/i,
  /anime-planet\.com\/images\/people\/default\/default-staff\.svg/i,
];

export const isPlaceholderEntityImageUrl = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized) {
    return true;
  }

  return MAL_PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(normalized));
};

export const sanitizeEntityImageUrl = (value?: string | null) => {
  const normalized = normalizeText(value);
  if (!normalized || isPlaceholderEntityImageUrl(normalized)) {
    return undefined;
  }

  return normalized;
};
