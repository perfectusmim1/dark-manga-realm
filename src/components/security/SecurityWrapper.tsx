import React, { useEffect } from 'react';
import { toast } from 'sonner';
import CustomContextMenu from './CustomContextMenu';

const SecurityWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    useEffect(() => {
        const infiniteDebugger = () => {
            const start = Date.now();
            // eslint-disable-next-line no-debugger
            debugger;
            const end = Date.now();
            if (end - start > 100) {
            }
        };

        let debuggerInterval: any;

        if (import.meta.env.PROD) {
            debuggerInterval = setInterval(infiniteDebugger, 2000);
        }

        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            return false;
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            const blockedKeys = [123, 73, 74, 85, 83, 80];
            if (blockedKeys.includes(e.keyCode) && (e.ctrlKey || e.shiftKey || e.keyCode === 123)) {
                e.preventDefault();
                e.stopPropagation();
                
                if (e.keyCode === 123 || (e.ctrlKey && (e.keyCode === 73 || e.keyCode === 74 || e.keyCode === 85))) {
                    toast.error("Developer Tools are restricted", {
                        description: "Standard keyboard shortcuts have been disabled for security."
                    });
                }
                
                return false;
            }
        };

        const extensionDetector = () => {
            const suspiciousTags = ['image-downloader', 'down-loader-tool'];

            const checkExtensions = () => {
                suspiciousTags.forEach(tag => {
                    if (document.getElementsByTagName(tag).length > 0) {
                        console.warn("Suspicious extension detected");
                    }
                });

                const adblockInjected = document.querySelectorAll('.adblock-injected, .ext-downloader');
                adblockInjected.forEach(el => el.remove());
            };

            setInterval(checkExtensions, 3000);
        };

        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const wrapper = document.getElementById('app-security-wrapper');
                    if (!wrapper) window.location.reload();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: false,
            childList: true,
            subtree: true
        });

        const protectConsole = () => {
            const dummy = () => { };
            const methods = ['log', 'debug', 'info', 'warn', 'error', 'table', 'clear'];
            methods.forEach(method => {
                try {
                    // @ts-ignore
                    window.console[method] = dummy;
                    Object.defineProperty(window.console, method, {
                        get: () => dummy,
                        set: () => dummy,
                        configurable: false
                    });
                } catch (e) { }
            });
        };

        if (import.meta.env.PROD) {
            protectConsole();
            extensionDetector();
        }

        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('dragstart', (e) => e.preventDefault());

        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('keydown', handleKeyDown, true);
            observer.disconnect();
            if (debuggerInterval) clearInterval(debuggerInterval);
        };
    }, []);

    return (
        <div id="app-security-wrapper" className="select-none pointer-events-auto min-h-screen">
            {children}
            <CustomContextMenu />
            
            <style dangerouslySetInnerHTML={{
                __html: `
          * {
            -webkit-touch-callout: none !important;
            -webkit-user-select: none !important;
            -khtml-user-select: none !important;
            -moz-user-select: none !important;
            -ms-user-select: none !important;
            user-select: none !important;
          }
          
          .selectable-text, p, span, h1, h2, h3, h4, h5, h6, b, i, strong, em, article, section, label {
            -webkit-user-select: text !important;
            -khtml-user-select: text !important;
            -moz-user-select: text !important;
            -ms-user-select: text !important;
            user-select: text !important;
          }
          
          input, textarea, [contenteditable="true"] {
            -webkit-user-select: text !important;
            user-select: text !important;
          }
          
          img {
            pointer-events: none !important;
            -webkit-user-drag: none !important;
          }
          
          .protection-layer {
            background: rgba(0,0,0,0);
            -webkit-backdrop-filter: blur(0px);
            backdrop-filter: blur(0px);
          }
          
          @media print {
            body { display: none !important; }
          }
        `
            }} />
        </div>
    );
};

export default SecurityWrapper;
