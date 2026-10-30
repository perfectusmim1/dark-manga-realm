import React, { useEffect, useRef, useState } from 'react';
import { getCachedImageAsset, prefetchImageAsset } from '@/lib/imagePrefetch';
import { shouldAvoidRawImageFallback } from '@/lib/imageProxy';
import { buildProxiedImageUrl } from '@/lib/mediaStorage';

interface ProtectedImageProps {
    src: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
    zoom?: number;
    onMediaReadyChange?: (ready: boolean) => void;
    overlay?: React.ReactNode;
}

const ProtectedImage: React.FC<ProtectedImageProps> = ({
    src,
    alt,
    className,
    style,
    zoom = 100,
    onMediaReadyChange,
    overlay,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isExternalUrl = src.startsWith('http://') || src.startsWith('https://');
    const shouldBypassCanvas = src.startsWith('blob:') || src.startsWith('data:');
    const avoidRaw = shouldAvoidRawImageFallback(src);
    const [useFallback, setUseFallback] = useState(shouldBypassCanvas);
    const [isBroken, setIsBroken] = useState(false);
    const [isMediaReady, setIsMediaReady] = useState(false);
    const [useProxyFallback, setUseProxyFallback] = useState(avoidRaw);

    const currentSrc = (useProxyFallback || avoidRaw) && isExternalUrl
        ? buildProxiedImageUrl(src) || src
        : src;

    useEffect(() => {
        setUseFallback(shouldBypassCanvas);
        setIsBroken(false);
        setIsMediaReady(false);
        setUseProxyFallback(shouldAvoidRawImageFallback(src));
    }, [shouldBypassCanvas, src]);

    useEffect(() => {
        onMediaReadyChange?.(isMediaReady);
    }, [isMediaReady, onMediaReadyChange]);

    useEffect(() => {
        if (useFallback) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            setUseFallback(true);
            return;
        }

        let isCancelled = false;

        const drawImageToCanvas = (img: HTMLImageElement) => {
            if (isCancelled) {
                return;
            }

            try {
                const width = 1200;
                const height = (img.height / img.width) * width;
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                setIsMediaReady(true);
            } catch (e) {
                console.error("Canvas draw error, falling back to protected img", e);
                setUseFallback(true);
            }
        };

        const cachedImage = getCachedImageAsset(currentSrc);
        if (cachedImage) {
            drawImageToCanvas(cachedImage);
        } else {
            void prefetchImageAsset(currentSrc)
                .then((img) => drawImageToCanvas(img))
                .catch(() => {
                    if (!isCancelled) {
                        if (isExternalUrl && !useProxyFallback) {
                            setUseProxyFallback(true);
                        } else {
                            setUseFallback(true);
                        }
                    }
                });
        }

        // Tampering detection
        const observer = new MutationObserver(() => {
            if (containerRef.current && canvas && !containerRef.current.contains(canvas) && !useFallback) {
                setIsBroken(true);
            }
        });

        if (containerRef.current) {
            observer.observe(containerRef.current, { childList: true, subtree: true });
        }

        return () => {
            isCancelled = true;
            observer.disconnect();
        };
    }, [currentSrc, isExternalUrl, useFallback, useProxyFallback]);

    if (isBroken) {
        return <div className="w-full h-96 bg-black flex items-center justify-center text-red-500 font-bold">GÜVENLİK İHLALİ</div>;
    }

    const handleImgError = () => {
        if (isExternalUrl && !useProxyFallback) {
            const proxied = buildProxiedImageUrl(src);
            if (proxied && proxied !== currentSrc) {
                setUseProxyFallback(true);
                return;
            }
        }
        setIsMediaReady(false);
    };

    return (
        <div
            ref={containerRef}
            className={`relative select-none ${className}`}
            style={{
                ...style,
                width: `${zoom}%`,
                maxWidth: '100%',
                lineHeight: 0,
                marginLeft: 'auto',
                marginRight: 'auto',
            }}
        >
            {useFallback ? (
                <img
                    src={currentSrc}
                    alt={alt}
                    className="w-full h-auto block select-none pointer-events-none"
                    draggable={false}
                    referrerPolicy="no-referrer"
                    onContextMenu={(e) => e.preventDefault()}
                    onLoad={() => setIsMediaReady(true)}
                    onError={handleImgError}
                    data-media-ready={isMediaReady ? 'true' : 'false'}
                    data-proxied={useProxyFallback ? 'true' : 'false'}
                    style={{
                        userSelect: 'none',
                        WebkitUserSelect: 'none',
                    }}
                />
            ) : (
                <canvas
                    ref={canvasRef}
                    className="w-full h-auto block pointer-events-none"
                    data-media-ready={isMediaReady ? 'true' : 'false'}
                    style={{ touchAction: 'none' }}
                />
            )}

            {/* Absolute protection overlay - hardest to bypass */}
            <div
                className="absolute inset-0 z-10 bg-transparent cursor-default protection-layer"
                onContextMenu={(e) => e.preventDefault()}
                style={{ pointerEvents: 'auto' }}
            />

            {overlay}
        </div>
    );
};

export default ProtectedImage;
