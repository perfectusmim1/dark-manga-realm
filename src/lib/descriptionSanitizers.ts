const CHARACTER_BOILERPLATE_PATTERNS = [
  /No voice actors have been added to this character\.\s*Help improve our database by adding a voice actor(?: here)?\.?/gi,
  /Bu karaktere seslendirme sanatçısı eklenmedi\.\s*Bir seslendirme sanatçısı arayıp bu karakteri rollerine ekleyerek veritabanımızın geliştirilmesine yardımcı olun\.?/gi,
];

const normalizeDescriptionSpacing = (value: string) =>
  value
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const sanitizeCharacterDescription = (value?: string | null) => {
  let sanitized = normalizeDescriptionSpacing(value || '');

  for (const pattern of CHARACTER_BOILERPLATE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  sanitized = normalizeDescriptionSpacing(sanitized);
  return sanitized || undefined;
};

export const sanitizeMangaDescription = (value?: string | null): string => {
  if (!value) return '';
  let cleaned = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/br>/gi, '\n')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  cleaned = cleaned.replace(/<[^>]+>/g, '');
  return normalizeDescriptionSpacing(cleaned);
};

