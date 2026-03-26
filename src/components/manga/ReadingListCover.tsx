import React, { useEffect, useState } from 'react';
import { List } from 'lucide-react';
import { cn } from '@/lib/utils';
import OptimizedImage from '@/components/media/OptimizedImage';

interface ReadingListCoverProps {
    imageUrl?: string | null;
    alt: string;
    className?: string;
    imageClassName?: string;
    iconClassName?: string;
    labelClassName?: string;
    showLabel?: boolean;
}

const ReadingListCover: React.FC<ReadingListCoverProps> = ({
    imageUrl,
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

    const showImage = Boolean(imageUrl) && !hasError;

    return (
        <div className={cn('relative overflow-hidden bg-gradient-to-br from-primary/20 via-secondary/70 to-background', className)}>
            {showImage ? (
                <>
                    <OptimizedImage
                        src={imageUrl as string}
                        alt={alt}
                        rootMargin="420px 0px"
                        containerClassName="h-full w-full"
                        placeholderClassName="rounded-none"
                        className={cn('h-full w-full object-cover', imageClassName)}
                        sizes="(min-width: 1280px) 28vw, (min-width: 640px) 44vw, 100vw"
                        onError={() => setHasError(true)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
                </>
            ) : (
                <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.18),_transparent_55%)]">
                    <List className={cn('h-10 w-10 text-primary/70', iconClassName)} />
                </div>
            )}

            {showLabel && !showImage && (
                <div className={cn('absolute inset-x-0 bottom-0 p-3 text-center text-xs font-medium text-muted-foreground', labelClassName)}>
                    Liste Kapagi
                </div>
            )}
        </div>
    );
};

export default ReadingListCover;
