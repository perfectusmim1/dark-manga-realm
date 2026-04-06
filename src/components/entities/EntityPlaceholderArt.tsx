import React from 'react';
import { cn } from '@/lib/utils';

interface EntityPlaceholderArtProps {
    name: string;
    className?: string;
    initialClassName?: string;
}

const EntityPlaceholderArt: React.FC<EntityPlaceholderArtProps> = ({
    className,
    initialClassName,
}) => {
    return (
        <div
            aria-hidden="true"
            className={cn(
                'relative isolate h-full w-full overflow-hidden bg-slate-900',
                className
            )}
        >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(148,163,184,0.20),transparent_34%),linear-gradient(145deg,rgba(51,65,85,0.92),rgba(15,23,42,0.98)_58%,rgba(8,13,22,1))]" />
            <div className="absolute inset-0 bg-[linear-gradient(135deg,transparent_0%,transparent_44%,rgba(255,255,255,0.055)_44%,rgba(255,255,255,0.055)_50%,transparent_50%,transparent_100%)] opacity-70" />
            <div className="absolute inset-[12%] rounded-[28%] border border-white/10 bg-white/[0.025] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]" />
            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />

            <div className="relative flex h-full items-center justify-center">
                <span
                    className={cn(
                        'select-none font-black tracking-[-0.04em] text-slate-200/90 drop-shadow-[0_14px_34px_rgba(0,0,0,0.65)]',
                        initialClassName
                    )}
                >
                    ?
                </span>
            </div>
        </div>
    );
};

export default EntityPlaceholderArt;
