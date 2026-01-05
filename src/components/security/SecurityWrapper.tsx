import React, { useEffect } from 'react';

const SecurityWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    useEffect(() => {
        // 1. Permanent Debugger Loop - Modified to be less intrusive for loading
        const infiniteDebugger = () => {
            const start = Date.now();
            // eslint-disable-next-line no-debugger
            debugger;
            const end = Date.now();
            if (end - start > 100) {
                // DevTools detected
            }
        };

        let debuggerInterval: any;
        const isDevSecret = localStorage.getItem('disable_protection') === 'true';

        // Disable debugger in local development unless specified to avoid freezing during loads
        if (!isDevSecret && import.meta.env.PROD) {
            debuggerInterval = setInterval(infiniteDebugger, 2000);
        }

        // 2. Disable Context Menu & Shortcuts
        const handleContextMenu = (e: MouseEvent) => {
            e.preventDefault();
            return false;
        };

        const handleKeyDown = (e: KeyboardEvent) => {
            const blockedKeys = [123, 73, 74, 67, 85, 83, 80];
            if (blockedKeys.includes(e.keyCode) && (e.ctrlKey || e.shiftKey || e.keyCode === 123)) {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }
        };

        // 3. 3rd-Party Extension Detection - Made safer for images
        const extensionDetector = () => {
            const suspiciousTags = ['image-downloader', 'down-loader-tool'];

            const checkExtensions = () => {
                suspiciousTags.forEach(tag => {
                    if (document.getElementsByTagName(tag).length > 0) {
                        console.warn("Suspicious extension detected");
                    }
                });

                // Scan for elements only if they are not part of our reader
                const adblockInjected = document.querySelectorAll('.adblock-injected, .ext-downloader');
                adblockInjected.forEach(el => el.remove());
            };

            setInterval(checkExtensions, 3000);
        };

        // 4. MutationObserver - Improved to ignore legitimate image loads
        const observer = new MutationObserver((mutations) => {
            if (isDevSecret) return;

            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    const wrapper = document.getElementById('app-security-wrapper');
                    if (!wrapper) window.location.reload();
                }
            });
        });

        observer.observe(document.documentElement, {
            attributes: false, // Changed to false to avoid triggering on every style change
            childList: true,
            subtree: true
        });

        // 5. Console Protection
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

        if (!isDevSecret) {
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
