import React, { useEffect, useRef, useState } from 'react';
import { getCachedImageAsset, prefetchImageAsset } from '@/lib/imagePrefetch';

interface ProtectedImageProps {
    src: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
    zoom?: number;
}

const ProtectedImage: React.FC<ProtectedImageProps> = ({ src, alt, className, style, zoom = 100 }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [useFallback, setUseFallback] = useState(false);
    const [isBroken, setIsBroken] = useState(false);
    const [isMediaReady, setIsMediaReady] = useState(false);

    useEffect(() => {
        setUseFallback(false);
        setIsBroken(false);
        setIsMediaReady(false);
    }, [src]);

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

        const cachedImage = getCachedImageAsset(src);
        if (cachedImage) {
            drawImageToCanvas(cachedImage);
        } else {
            void prefetchImageAsset(src)
                .then((img) => drawImageToCanvas(img))
                .catch(() => {
                    if (!isCancelled) {
                        setUseFallback(true);
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
    }, [src, useFallback]);

    if (isBroken) {
        return <div className="w-full h-96 bg-black flex items-center justify-center text-red-500 font-bold">GÜVENLİK İHLALİ</div>;
    }

    return (
        <div
            ref={containerRef}
            className={`relative select-none ${className}`}
            style={{
                ...style,
                width: `${zoom}%`,
                maxWidth: '100%',
                lineHeight: 0
            }}
        >
            {useFallback ? (
                <img
                    src={src}
                    alt={alt}
                    className="w-full h-auto block select-none pointer-events-none"
                    draggable={false}
                    onContextMenu={(e) => e.preventDefault()}
                    onLoad={() => setIsMediaReady(true)}
                    onError={() => setIsMediaReady(false)}
                    data-media-ready={isMediaReady ? 'true' : 'false'}
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
        </div>
    );
};

export default ProtectedImage;
