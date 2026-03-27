interface ParsedManagedArtworkUrl {
  prefix: string;
  widths: number[];
}

const MANAGED_ARTWORK_BUCKET = 'manga-artwork';

const parseManagedArtworkUrl = (url: string): ParsedManagedArtworkUrl | null => {
  try {
    const parsed = new URL(url);
    const marker = `/storage/v1/object/public/${MANAGED_ARTWORK_BUCKET}/`;
    const markerIndex = parsed.pathname.indexOf(marker);

    if (markerIndex === -1) {
      return null;
    }

    const relativePath = parsed.pathname.slice(markerIndex + marker.length);
    const match = relativePath.match(/^(mangas\/[^/]+\/(?:cover|banner)\/[^/]+\/)w(\d+)\.webp$/);
    if (!match) {
      return null;
    }

    const fallbackWidth = Number.parseInt(match[2], 10);
    const widths = (parsed.searchParams.get('vw') || '')
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value) && value > 0);

    if (!widths.includes(fallbackWidth)) {
      widths.push(fallbackWidth);
    }

    widths.sort((left, right) => left - right);

    return {
      prefix: `${parsed.origin}${marker}${match[1]}`,
      widths,
    };
  } catch {
    return null;
  }
};

export const isManagedArtworkUrl = (url?: string | null) =>
  Boolean(url && parseManagedArtworkUrl(url));

export const getManagedArtworkSrcSet = (url?: string | null) => {
  if (!url) {
    return undefined;
  }

  const parsed = parseManagedArtworkUrl(url);
  if (!parsed) {
    return undefined;
  }

  return parsed.widths
    .map((width) => `${parsed.prefix}w${width}.webp ${width}w`)
    .join(', ');
};
