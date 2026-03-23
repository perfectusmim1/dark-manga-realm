import React, { useState, useEffect, useRef } from 'react';
import { Copy, Share2, Info, ArrowUpLeft } from 'lucide-react';
import { toast } from 'sonner';

const CustomContextMenu: React.FC = () => {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const [selectedText, setSelectedText] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleContextMenu = (e: MouseEvent) => {
            const selection = window.getSelection()?.toString().trim();
            if (selection) {
                setSelectedText(selection);
            } else {
                setSelectedText('');
            }
            
            e.preventDefault();
            setVisible(true);
            
            let x = e.clientX;
            let y = e.clientY;
            
            const menuWidth = 200;
            const menuHeight = 220;
            
            if (x + menuWidth > window.innerWidth) x -= menuWidth;
            if (y + menuHeight > window.innerHeight) y -= menuHeight;
            
            setPosition({ x, y });
        };

        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
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

    const menuItems = [
        {
            label: 'Copy Selected Text',
            icon: <Copy className="w-4 h-4" />,
            action: () => {
                if (selectedText) {
                    navigator.clipboard.writeText(selectedText);
                    toast.success("Text copied to clipboard");
                } else {
                    toast.info("No text selected to copy");
                }
            }
        },
        {
            label: 'Share Content',
            icon: <Share2 className="w-4 h-4" />,
            action: () => {
                if (navigator.share) {
                    navigator.share({
                        title: 'ToonParrot',
                        url: window.location.href
                    }).catch(() => {});
                } else {
                    navigator.clipboard.writeText(window.location.href);
                    toast.success("Page URL copied to clipboard");
                }
            }
        },
        {
            label: 'Scroll to Top',
            icon: <ArrowUpLeft className="w-4 h-4" />,
            action: () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        },
        {
            label: 'Site Information',
            icon: <Info className="w-4 h-4" />,
            action: () => {
                toast.info("ToonParrot Security", {
                    description: "Custom interface enabled for better experience."
                });
            }
        }
    ];

    if (!visible) return null;

    return (
        <div
            ref={menuRef}
            className="fixed z-[10000] p-1.5 min-w-[200px] animate-scale-in"
            style={{
                left: `${position.x}px`,
                top: `${position.y}px`,
            }}
        >
            <div className="bg-card/90 backdrop-blur-xl border border-border rounded-xl shadow-2xl overflow-hidden py-1">
                {menuItems.map((item, index) => (
                    <button
                        key={index}
                        onClick={() => {
                            item.action();
                            setVisible(false);
                        }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-foreground hover:bg-primary/20 transition-colors group"
                    >
                        <span className="text-muted-foreground group-hover:text-primary transition-colors">
                            {item.icon}
                        </span>
                        <span>{item.label}</span>
                    </button>
                ))}
            </div>
            
            {/* Context menu glow effect */}
            <div className="absolute -z-10 inset-0 -m-4 bg-primary/5 blur-2xl rounded-full pointer-events-none" />
        </div>
    );
};

export default CustomContextMenu;
