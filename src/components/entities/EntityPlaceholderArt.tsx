import React from 'react';
import { cn } from '@/lib/utils';

interface EntityPlaceholderArtProps {
    name: string;
    className?: string;
    initialClassName?: string;
}

const hashSeed = (value: string) => {
    let hash = 0;

    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }

    return hash;
};

const getInitial = (name: string) => {
    const trimmed = name.trim();
    const match = trimmed.match(/[\p{L}\p{N}]/u);

    return (match?.[0] || '?').toLocaleUpperCase('tr-TR');
};

const getPalette = (name: string) => {
    const seed = hashSeed(name || 'entity');
    const hue = seed % 360;
    const accentHue = (hue + 36 + (seed % 24)) % 360;
    const contrastHue = (hue + 180 + (seed % 45)) % 360;

    return {
        hue,
        accentHue,
        contrastHue,
        tilt: 110 + (seed % 60),
        ringOffset: 12 + (seed % 18),
    };
};

const EntityPlaceholderArt: React.FC<EntityPlaceholderArtProps> = ({
    name,
    className,
    initialClassName,
}) => {
    const initial = getInitial(name);
    const palette = getPalette(name);

    return (
        <div
            aria-hidden="true"
            className={cn(
                'relative isolate h-full w-full overflow-hidden bg-slate-950',
                className
            )}
            style={{
                backgroundImage: [
                    `radial-gradient(circle at 18% 18%, hsla(${palette.hue}, 92%, 64%, 0.34), transparent 36%)`,
                    `radial-gradient(circle at 82% 24%, hsla(${palette.accentHue}, 88%, 60%, 0.30), transparent 34%)`,
                    `radial-gradient(circle at 50% 78%, hsla(${palette.contrastHue}, 74%, 55%, 0.20), transparent 42%)`,
                    `linear-gradient(${palette.tilt}deg, hsl(${palette.hue} 42% 16%) 0%, hsl(${palette.accentHue} 34% 11%) 52%, hsl(${palette.contrastHue} 40% 10%) 100%)`,
                ].join(', '),
            }}
        >
            <div
                className="absolute inset-0 opacity-70"
                style={{
                    backgroundImage: `linear-gradient(${palette.tilt + 35}deg, transparent 0%, transparent 42%, hsla(0, 0%, 100%, 0.08) 42%, transparent 58%, transparent 100%)`,
                }}
            />

            <div
                className="absolute -left-[16%] top-[12%] h-[54%] w-[56%] rounded-full blur-3xl"
                style={{ background: `hsla(${palette.hue}, 96%, 64%, 0.34)` }}
            />
            <div
                className="absolute -right-[12%] bottom-[8%] h-[46%] w-[52%] rounded-full blur-3xl"
                style={{ background: `hsla(${palette.accentHue}, 92%, 60%, 0.28)` }}
            />

            <div
                className="absolute left-1/2 top-1/2 h-[72%] w-[72%] -translate-x-1/2 -translate-y-1/2 rounded-full border opacity-45"
                style={{
                    borderColor: `hsla(${palette.contrastHue}, 92%, 86%, 0.36)`,
                    transform: `translate(-50%, -50%) rotate(${palette.ringOffset}deg)`,
                }}
            />
            <div
                className="absolute left-1/2 top-1/2 h-[52%] w-[52%] -translate-x-1/2 -translate-y-1/2 rounded-full border opacity-30"
                style={{
                    borderColor: `hsla(${palette.hue}, 92%, 90%, 0.32)`,
                    transform: `translate(-50%, -50%) rotate(${-palette.ringOffset}deg)`,
                }}
            />

            <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/40 via-black/10 to-transparent" />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,transparent_52%,rgba(255,255,255,0.06)_100%)]" />

            <div className="relative flex h-full items-center justify-center">
                <span
                    className={cn(
                        'select-none font-black tracking-[-0.08em] text-white/88 drop-shadow-[0_14px_34px_rgba(0,0,0,0.55)]',
                        initialClassName
                    )}
                >
                    {initial}
                </span>
            </div>
        </div>
    );
};

export default EntityPlaceholderArt;
