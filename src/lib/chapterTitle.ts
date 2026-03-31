const CHAPTER_PREFIXES = ['bölüm', 'bolum', 'chapter', 'chap', 'episode', 'ep'];
const CHAPTER_SEPARATOR_CHARS = new Set([':', '：', '-', '–', '—', '|', '.', '_']);

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
    const normalizedTitle = trimmedTitle.toLocaleLowerCase('tr-TR');
    const normalizedChapterNumber = chapterNumberLabel.trim().toLocaleLowerCase('tr-TR');

    const trimLeadingDecorators = (value: string) => {
        let index = 0;

        while (index < value.length && /\s/u.test(value[index])) {
            index += 1;
        }

        while (index < value.length && CHAPTER_SEPARATOR_CHARS.has(value[index])) {
            index += 1;
        }

        while (index < value.length && /\s/u.test(value[index])) {
            index += 1;
        }

        return value.slice(index);
    };

    const stripPrefixedTitle = (prefix: string) => {
        if (!normalizedTitle.startsWith(prefix)) {
            return trimmedTitle;
        }

        const remainder = trimmedTitle.slice(prefix.length).trimStart();
        if (!remainder.toLocaleLowerCase('tr-TR').startsWith(normalizedChapterNumber)) {
            return trimmedTitle;
        }

        return trimLeadingDecorators(remainder.slice(chapterNumberLabel.length)).trim();
    };

    for (const prefix of CHAPTER_PREFIXES) {
        const strippedTitle = stripPrefixedTitle(prefix);
        if (strippedTitle !== trimmedTitle) {
            return strippedTitle;
        }
    }

    if (normalizedTitle.startsWith(normalizedChapterNumber)) {
        return trimLeadingDecorators(trimmedTitle.slice(chapterNumberLabel.length)).trim();
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
