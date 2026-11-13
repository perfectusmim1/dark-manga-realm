import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import OptimizedImage from '@/components/media/OptimizedImage';

interface ReadingListCoverProps {
    imageUrl?: string | null;
    previewCovers?: string[];
    alt: string;
    className?: string;
    imageClassName?: string;
    iconClassName?: string;
    labelClassName?: string;
    showLabel?: boolean;
}

const ReadingListCover: React.FC<ReadingListCoverProps> = ({
    imageUrl,
    previewCovers,
    alt,
    className,
    imageClassName,
    iconClassName,
    labelClassName,
    showLabel = false,
}) => {
    const [hasError, setHasError] = useState(false);

    useEffect(() => {
        setHasError(false);
    }, [imageUrl]);

    const normalizedPreviewCovers = useMemo(
        () => (previewCovers || []).map((cover) => cover?.trim()).filter(Boolean).slice(0, 4),
        [previewCovers],
    );

    const effectiveSingleImage = useMemo(() => {
        if (imageUrl && !hasError) {
            return imageUrl;
        }
        if (normalizedPreviewCovers.length === 1) {
            return normalizedPreviewCovers[0];
        }
        return undefined;
    }, [hasError, imageUrl, normalizedPreviewCovers]);

    const showCollage = !imageUrl && normalizedPreviewCovers.length >= 2;
    const showSingleImage = Boolean(effectiveSingleImage);

    return (
        <div className={cn('relative overflow-hidden bg-gradient-to-br from-primary/20 via-secondary/70 to-background', className)}>
            {showSingleImage ? (
                <>
                    <OptimizedImage
                        src={effectiveSingleImage as string}
                        alt={alt}
                        allowProxy
                        transform={{ width: 240, quality: 80 }}
                        rootMargin="420px 0px"
                        containerClassName="h-full w-full"
                        placeholderClassName="rounded-none"
                        className={cn('h-full w-full object-cover', imageClassName)}
                        sizes="(min-width: 1280px) 28vw, (min-width: 640px) 44vw, 100vw"
                        onError={() => setHasError(true)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
                </>
            ) : showCollage ? (
                <div
                    className={cn(
                        'grid h-full w-full gap-0.5 bg-border/40',
                        normalizedPreviewCovers.length >= 3 ? 'grid-cols-2 grid-rows-2' : 'grid-cols-2',
                    )}
                >
                    {normalizedPreviewCovers.slice(0, normalizedPreviewCovers.length >= 3 ? 4 : 2).map((src, index) => (
                        <OptimizedImage
                            key={`${src}-${index}`}
                            src={src}
                            alt={`${alt} kapak ${index + 1}`}
                            allowProxy
                            transform={{ width: 160, quality: 75 }}
                            containerClassName="h-full w-full bg-muted"
                            placeholderClassName="rounded-none"
                            className="h-full w-full object-cover"
                        />
                    ))}
                </div>
            ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_55%)]">
                    <BookOpen className={cn('h-8 w-8 text-primary/70', iconClassName)} />
                </div>
            )}

            {showLabel && !showSingleImage && !showCollage && (
                <div className={cn('absolute inset-x-0 bottom-0 p-3 text-center text-xs font-medium text-muted-foreground', labelClassName)}>
                    Liste Kapağı
                </div>
            )}
        </div>
    );
};

export default ReadingListCover;
