import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import {
    getSiteSecuritySettings,
    SiteSecuritySettings,
    subscribeToSiteSecuritySettings,
} from '@/lib/siteSecurity';
import CustomContextMenu from './CustomContextMenu';

const SecurityWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { user } = useAuth();
    const [settings, setSettings] = useState<SiteSecuritySettings>({
        devtoolsProtectionEnabled: false,
        adblockWarningEnabled: false,
        updatedAt: null,
        updatedBy: null,
    });
    const isAdmin = user?.role === 'admin';
    const shouldEnforce = import.meta.env.PROD && settings.devtoolsProtectionEnabled && !isAdmin;

    useEffect(() => {
        let isActive = true;

        void getSiteSecuritySettings()
            .then((loadedSettings) => {
                if (isActive) {
                    setSettings(loadedSettings);
                }
            })
            .catch((error) => {
                console.error('Site security settings could not be loaded:', error);
            });

        const unsubscribe = subscribeToSiteSecuritySettings((nextSettings) => {
            if (isActive) {
                setSettings(nextSettings);
            }
        });

        return () => {
            isActive = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!shouldEnforce) {
            return;
        }

        const infiniteDebugger = () => {
            // eslint-disable-next-line no-debugger
            debugger;
        };

        let debuggerInterval: number | undefined;
        let extensionInterval: number | undefined;

        debuggerInterval = window.setInterval(infiniteDebugger, 2000);

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
                    toast.error("Geliştirici araçları kısıtlandı", {
                        description: "Bu sitede standart geliştirici araçları kısayolları devre dışı."
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

            extensionInterval = window.setInterval(checkExtensions, 3000);
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

        const handleDragStart = (e: DragEvent) => e.preventDefault();

        extensionDetector();

        document.addEventListener('contextmenu', handleContextMenu);
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('dragstart', handleDragStart);

        return () => {
            document.removeEventListener('contextmenu', handleContextMenu);
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('dragstart', handleDragStart);
            observer.disconnect();
            if (debuggerInterval) window.clearInterval(debuggerInterval);
            if (extensionInterval) window.clearInterval(extensionInterval);
        };
    }, [shouldEnforce]);

    return (
        <div
            id="app-security-wrapper"
            className={`pointer-events-auto min-h-screen ${shouldEnforce ? 'select-none' : ''}`}
        >
            {children}
            {shouldEnforce ? <CustomContextMenu /> : null}
            
            {shouldEnforce ? (
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
            ) : null}
        </div>
    );
};

export default SecurityWrapper;
