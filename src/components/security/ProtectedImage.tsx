import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { getCachedImageAsset } from '@/lib/imagePrefetch';
import { shouldAvoidRawImageFallback } from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';

const IMAGE_DIMS_STORAGE_KEY = 'toonparrot_img_dims_v1';
const memoryImageDimsCache = new Map<string, [number, number]>();
let sessionDimsHydrated = false;
let dimsPersistTimer: number | null = null;

const scheduleDimsPersist = () => {
    if (typeof window === 'undefined' || dimsPersistTimer !== null) return;
    dimsPersistTimer = window.setTimeout(() => {
        dimsPersistTimer = null;
        try {
            const entries = Array.from(memoryImageDimsCache.entries()).slice(-400);
            const obj: Record<string, [number, number]> = {};
            for (const [k, v] of entries) {
                obj[k] = v;
            }
            window.sessionStorage.setItem(IMAGE_DIMS_STORAGE_KEY, JSON.stringify(obj));
        } catch {
            // ignore quota errors
        }
    }, 450);
};

const hydrateDimsFromSession = () => {
    if (sessionDimsHydrated || typeof window === 'undefined') return;
    sessionDimsHydrated = true;
    try {
        const raw = window.sessionStorage.getItem(IMAGE_DIMS_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, [number, number]>;
        if (parsed && typeof parsed === 'object') {
            for (const [key, val] of Object.entries(parsed)) {
                if (Array.isArray(val) && val.length === 2 && val[0] > 0 && val[1] > 0) {
                    memoryImageDimsCache.set(key, [val[0], val[1]]);
                }
            }
        }
    } catch {
        // ignore storage errors
    }
};

const getKnownImageDims = (rawSrc: string, resolvedSrc: string): [number, number] | null => {
    hydrateDimsFromSession();
    const fromMem = memoryImageDimsCache.get(rawSrc) || memoryImageDimsCache.get(resolvedSrc);
    if (fromMem) return fromMem;
    const cachedAsset = getCachedImageAsset(resolvedSrc) || getCachedImageAsset(rawSrc);
    if (cachedAsset && cachedAsset.naturalWidth > 0 && cachedAsset.naturalHeight > 0) {
        const dims: [number, number] = [cachedAsset.naturalWidth, cachedAsset.naturalHeight];
        memoryImageDimsCache.set(rawSrc, dims);
        memoryImageDimsCache.set(resolvedSrc, dims);
        return dims;
    }
    return null;
};

const recordKnownImageDims = (rawSrc: string, resolvedSrc: string, width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    hydrateDimsFromSession();
    const prev = memoryImageDimsCache.get(rawSrc);
    if (prev && prev[0] === width && prev[1] === height) return;
    const dims: [number, number] = [width, height];
    memoryImageDimsCache.set(rawSrc, dims);
    memoryImageDimsCache.set(resolvedSrc, dims);
    scheduleDimsPersist();
};

interface ProtectedImageProps {
    src: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
    zoom?: number;
    priority?: boolean;
    reserveHeightWhenLoading?: boolean;
    onMediaReadyChange?: (ready: boolean) => void;
    overlay?: React.ReactNode;
}

const ProtectedImageComponent: React.FC<ProtectedImageProps> = ({
    src,
    alt,
    className,
    style,
    zoom = 100,
    priority = false,
    reserveHeightWhenLoading = false,
    onMediaReadyChange,
    overlay,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const imgRef = useRef<HTMLImageElement | null>(null);
    const prevSrcRef = useRef<string>(src);
    const isExternalUrl = src.startsWith('http://') || src.startsWith('https://');
    const avoidRaw = shouldAvoidRawImageFallback(src);
    const [useProxyFallback, setUseProxyFallback] = useState(avoidRaw);

    const currentSrc = (useProxyFallback || avoidRaw) && isExternalUrl
        ? buildProxiedImageUrl(src) || src
        : src;

    const [knownDims, setKnownDims] = useState<[number, number] | null>(() =>
        getKnownImageDims(src, currentSrc)
    );
    const [isMediaReady, setIsMediaReady] = useState<boolean>(() => {
        const cached = getCachedImageAsset(currentSrc) || getCachedImageAsset(src);
        return Boolean(cached && cached.naturalWidth > 0);
    });

    useEffect(() => {
        if (prevSrcRef.current === src) {
            return;
        }
        prevSrcRef.current = src;
        const nextAvoidRaw = shouldAvoidRawImageFallback(src);
        const nextResolvedSrc = (nextAvoidRaw && (src.startsWith('http://') || src.startsWith('https://')))
            ? buildProxiedImageUrl(src) || src
            : src;
        setUseProxyFallback(nextAvoidRaw);
        const dims = getKnownImageDims(src, nextResolvedSrc);
        setKnownDims(dims);
        const cached = getCachedImageAsset(nextResolvedSrc) || getCachedImageAsset(src);
        setIsMediaReady(Boolean(cached && cached.naturalWidth > 0));
    }, [src]);

    useEffect(() => {
        onMediaReadyChange?.(isMediaReady);
    }, [isMediaReady, onMediaReadyChange]);

    const handleImgLoad = useCallback((el: HTMLImageElement) => {
        if (el.naturalWidth > 0 && el.naturalHeight > 0) {
            recordKnownImageDims(src, currentSrc, el.naturalWidth, el.naturalHeight);
            setKnownDims((prev) =>
                prev && prev[0] === el.naturalWidth && prev[1] === el.naturalHeight
                    ? prev
                    : [el.naturalWidth, el.naturalHeight]
            );
        }
        setIsMediaReady((prev) => (prev ? prev : true));
    }, [currentSrc, src]);

    useEffect(() => {
        const el = imgRef.current;
        if (el && el.complete && el.naturalWidth > 0) {
            handleImgLoad(el);
        }
    }, [currentSrc, handleImgLoad]);

    const handleImgError = useCallback(() => {
        if (isExternalUrl && !useProxyFallback) {
            const proxied = buildProxiedImageUrl(src);
            if (proxied && proxied !== currentSrc) {
                setUseProxyFallback(true);
                return;
            }
        }
        setIsMediaReady(false);
    }, [currentSrc, isExternalUrl, src, useProxyFallback]);

    const effectiveDims = knownDims || getKnownImageDims(src, currentSrc);

    return (
        <div
            ref={containerRef}
            className={`relative select-none ${className || ''}`}
            style={{
                ...style,
                width: `${zoom}%`,
                maxWidth: '100%',
                aspectRatio: effectiveDims ? `${effectiveDims[0]} / ${effectiveDims[1]}` : style?.aspectRatio,
                minHeight: !effectiveDims && !isMediaReady && reserveHeightWhenLoading ? '75vh' : style?.minHeight,
                lineHeight: 0,
                marginLeft: 'auto',
                marginRight: 'auto',
            }}
        >
            <img
                ref={imgRef}
                src={currentSrc}
                alt={alt}
                decoding="async"
                loading={priority ? 'eager' : 'lazy'}
                className="w-full h-auto block select-none pointer-events-none"
                draggable={false}
                referrerPolicy="no-referrer"
                onContextMenu={(e) => e.preventDefault()}
                onLoad={(e) => handleImgLoad(e.currentTarget)}
                onError={handleImgError}
                data-media-ready={isMediaReady || Boolean(effectiveDims) ? 'true' : 'false'}
                data-proxied={useProxyFallback ? 'true' : 'false'}
                style={{
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                }}
            />

            {/* Absolute protection overlay - hardest to bypass */}
            <div
                className="absolute inset-0 z-10 bg-transparent cursor-default protection-layer"
                onContextMenu={(e) => e.preventDefault()}
                style={{ pointerEvents: 'auto' }}
            />

            {isMediaReady ? overlay : null}
        </div>
    );
};

const ProtectedImage = memo(ProtectedImageComponent);
export default ProtectedImage;
