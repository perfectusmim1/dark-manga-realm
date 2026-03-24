const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const formatChapterNumberLabel = (value: number | string) => {
    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return value.toString();
        }

        return value.toFixed(1).replace(/\.0$/, '');
    }

    return value.trim();
};

const stripRepeatedChapterPrefix = (title: string, chapterNumberLabel: string) => {
    const trimmedTitle = title.trim();
    const escapedNumber = escapeRegExp(chapterNumberLabel);
    const patterns = [
        new RegExp(`^(?:b[oö]l[uü]m|chapter|chap(?:ter)?|ep(?:isode)?)\\s*${escapedNumber}(?:\\s*[:：\\-–—|._]+\\s*)?`, 'i'),
        new RegExp(`^${escapedNumber}(?:\\s*[:：\\-–—|._]+\\s*)?`, 'i'),
    ];

    for (const pattern of patterns) {
        const strippedTitle = trimmedTitle.replace(pattern, '').trim();

        if (strippedTitle !== trimmedTitle) {
            return strippedTitle;
        }
    }

    return trimmedTitle;
};

export const sanitizeChapterTitle = (chapterNumber: number | string, title?: string | null) => {
    const trimmedTitle = title?.trim();

    if (!trimmedTitle) {
        return '';
    }

    const chapterNumberLabel = formatChapterNumberLabel(chapterNumber);
    let cleanedTitle = trimmedTitle;

    while (cleanedTitle) {
        const nextTitle = stripRepeatedChapterPrefix(cleanedTitle, chapterNumberLabel);

        if (nextTitle === cleanedTitle) {
            break;
        }

        cleanedTitle = nextTitle;
    }

    return cleanedTitle;
};

export const formatChapterDisplayTitle = (chapterNumber: number | string, title?: string | null) => {
    const chapterLabel = `Bölüm ${formatChapterNumberLabel(chapterNumber)}`;
    const cleanedTitle = sanitizeChapterTitle(chapterNumber, title);

    return cleanedTitle ? `${chapterLabel}: ${cleanedTitle}` : chapterLabel;
};
