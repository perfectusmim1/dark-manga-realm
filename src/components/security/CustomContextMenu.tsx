import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpLeft, Copy, MessageCirclePlus, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { dispatchOpenPageComment } from '@/lib/pageCommentEvents';

const isReaderRoute = (pathname: string) => /^\/manga\/[^/]+\/chapter\/[^/]+/.test(pathname);

const CustomContextMenu: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [selectedText, setSelectedText] = useState('');
    const [contextPageNumber, setContextPageNumber] = useState<number | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleContextMenu = (event: MouseEvent) => {
            const selection = window.getSelection()?.toString().trim() || '';
            const pageElement = (event.target as HTMLElement | null)?.closest('[data-page-index]') as HTMLElement | null;
            const rawPageIndex = pageElement?.dataset.pageIndex;
            const nextPageNumber = isReaderRoute(window.location.pathname) && rawPageIndex !== undefined
                ? Number.parseInt(rawPageIndex, 10) + 1
                : NaN;

            setSelectedText(selection);
            setContextPageNumber(Number.isFinite(nextPageNumber) && nextPageNumber > 0 ? nextPageNumber : null);

            event.preventDefault();
            setVisible(true);

            const menuWidth = 240;
            const menuHeight = 56 + ((Number.isFinite(nextPageNumber) ? 4 : 3) * 44);
            let x = event.clientX;
            let y = event.clientY;

            if (x + menuWidth > window.innerWidth) {
                x = Math.max(8, x - menuWidth);
            }

            if (y + menuHeight > window.innerHeight) {
                y = Math.max(8, y - menuHeight);
            }

            setPosition({ x, y });
        };

        const handleClick = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setVisible(false);
            }
        };

        const handleScroll = () => {
            setVisible(false);
        };

        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('click', handleClick);
        window.addEventListener('scroll', handleScroll);

        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('click', handleClick);
            window.removeEventListener('scroll', handleScroll);
        };
    }, []);

    const menuItems = useMemo(() => {
        const items = [
            {
                label: 'Seçili Metni Kopyala',
                icon: <Copy className="w-4 h-4" />,
                action: () => {
                    if (!selectedText) {
                        toast.info('Kopyalanacak seçili metin yok');
                        return;
                    }

                    navigator.clipboard.writeText(selectedText);
                    toast.success('Metin panoya kopyalandı');
                },
            },
            {
                label: 'İçeriği Paylaş',
                icon: <Share2 className="w-4 h-4" />,
                action: () => {
                    if (navigator.share) {
                        navigator.share({
                            title: 'ToonParrot',
                            url: window.location.href,
                        }).catch(() => {});
                        return;
                    }

                    navigator.clipboard.writeText(window.location.href);
                    toast.success('Sayfa bağlantısı panoya kopyalandı');
                },
            },
        ];

        if (contextPageNumber) {
            items.push({
                label: `Sayfa ${contextPageNumber} İçin Yorum Yap`,
                icon: <MessageCirclePlus className="w-4 h-4" />,
                action: () => {
                    dispatchOpenPageComment({ pageNumber: contextPageNumber });
                    toast.success(`Sayfa ${contextPageNumber} yorum alanı açılıyor`);
                },
            });
        }

        items.push({
            label: 'En Üste Git',
            icon: <ArrowUpLeft className="w-4 h-4" />,
            action: () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            },
        });

        return items;
    }, [contextPageNumber, selectedText]);

    if (!visible) {
        return null;
    }

    return (
        <div
            ref={menuRef}
            className="fixed z-[10000] min-w-[232px] animate-scale-in p-1.5"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
            }}
        >
            <div className="overflow-hidden rounded-xl border border-border bg-card/90 py-1 shadow-2xl backdrop-blur-xl">
                {menuItems.map((item, index) => (
                    <button
                        key={`${item.label}-${index}`}
                        onClick={() => {
                            item.action();
                            setVisible(false);
                        }}
                        className="group flex w-full items-center gap-3 px-3 py-2 text-sm text-foreground transition-colors hover:bg-primary/20"
                    >
                        <span className="text-muted-foreground transition-colors group-hover:text-primary">
                            {item.icon}
                        </span>
                        <span>{item.label}</span>
                    </button>
                ))}
            </div>

            <div className="pointer-events-none absolute inset-0 -z-10 -m-4 rounded-full bg-primary/5 blur-2xl" />
        </div>
    );
};

export default CustomContextMenu;
