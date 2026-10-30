import { shouldAvoidRawImageFallback } from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';

interface PrefetchChapterOptions {
    concurrency?: number;
}

interface CachedImageEntry {
    image: HTMLImageElement;
    loaded: boolean;
    promise: Promise<HTMLImageElement>;
}

const imageCache = new Map<string, CachedImageEntry>();
const chapterSources = new Map<string, string[]>();
const chapterPrefetchPromises = new Map<string, Promise<void>>();

const normalizePrefetchSrc = (src: string) => {
    const trimmed = src?.trim() || '';
    if (!trimmed) return '';
    return shouldAvoidRawImageFallback(trimmed) ? (buildProxiedImageUrl(trimmed) || trimmed) : trimmed;
};

const createImagePromise = (src: string) => {
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    image.referrerPolicy = 'no-referrer';
    if ('fetchPriority' in image) {
        (image as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
    }

    const promise = new Promise<HTMLImageElement>((resolve, reject) => {
        const finalizeSuccess = () => {
            const cachedEntry = imageCache.get(src);
            if (cachedEntry) {
                cachedEntry.loaded = true;
            }
            resolve(image);
        };

        const finalizeError = () => {
            imageCache.delete(src);
            reject(new Error(`Image prefetch failed for ${src}`));
        };

        image.onload = () => {
            if ('decode' in image) {
                image.decode().catch(() => undefined).finally(finalizeSuccess);
                return;
            }

            finalizeSuccess();
        };

        image.onerror = finalizeError;
        image.src = src;

        if (image.complete && image.naturalWidth > 0) {
            finalizeSuccess();
        }
    });

    const entry: CachedImageEntry = {
        image,
        loaded: false,
        promise,
    };

    imageCache.set(src, entry);
    return entry;
};

export const prefetchImageAsset = async (rawSrc: string): Promise<HTMLImageElement> => {
    const src = normalizePrefetchSrc(rawSrc);
    const existing = imageCache.get(src);
    if (existing) {
        return existing.loaded ? existing.image : existing.promise;
    }

    const entry = createImagePromise(src);
    return entry.promise;
};

export const getCachedImageAsset = (rawSrc: string): HTMLImageElement | null => {
    const src = normalizePrefetchSrc(rawSrc);
    const entry = imageCache.get(src);
    if (!entry || !entry.loaded || !entry.image.complete || entry.image.naturalWidth === 0) {
        return null;
    }

    return entry.image;
};

export const prefetchChapterAssets = async (
    chapterId: string,
    sources: string[],
    options?: PrefetchChapterOptions
): Promise<void> => {
    if (!chapterId || sources.length === 0) {
        return;
    }

    const existingPromise = chapterPrefetchPromises.get(chapterId);
    if (existingPromise) {
        return existingPromise;
    }

    chapterSources.set(chapterId, [...sources]);
    const concurrency = Math.max(4, Math.min(options?.concurrency ?? 12, 24));

    const promise = (async () => {
        let currentIndex = 0;
        const workers = Array.from({ length: Math.min(concurrency, sources.length) }, async () => {
            while (currentIndex < sources.length) {
                const source = sources[currentIndex];
                currentIndex += 1;

                if (!source) {
                    continue;
                }

                try {
                    await prefetchImageAsset(source);
                } catch {
                    // Keep moving so one bad page does not block the rest.
                }
            }
        });

        await Promise.all(workers);
    })();

    chapterPrefetchPromises.set(chapterId, promise);
    return promise;
};

export const retainPrefetchedChapters = (chapterIds: string[]) => {
    const allowedIds = new Set(chapterIds.filter(Boolean));

    for (const [chapterId, sources] of chapterSources.entries()) {
        if (allowedIds.has(chapterId)) {
            continue;
        }

        chapterSources.delete(chapterId);
        chapterPrefetchPromises.delete(chapterId);

        for (const source of sources) {
            imageCache.delete(normalizePrefetchSrc(source));
        }
    }
};
