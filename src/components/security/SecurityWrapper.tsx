import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminAccess } from '@/hooks/useAdminAccess';
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
    const shouldValidateAdminBypass = settings.devtoolsProtectionEnabled
        && Boolean(user && (user.role === 'admin' || user.role === 'moderator'));
    const { access, isLoading: adminAccessLoading } = useAdminAccess({
        enabled: shouldValidateAdminBypass,
    });
    const isAdmin = user?.role === 'admin' || access.role === 'admin';
    const shouldEnforce = settings.devtoolsProtectionEnabled
        && (!user || (!adminAccessLoading && !isAdmin));

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

        let extensionInterval: number | undefined;

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

        const handleDragStart = (e: DragEvent) => {
            const target = e.target;
            if (target instanceof Element && target.closest('[data-allow-image-interaction="true"]')) {
                return;
            }

            e.preventDefault();
        };

        extensionDetector();

        document.addEventListener('contextmenu', handleContextMenu, true);
        document.addEventListener('keydown', handleKeyDown, true);
        document.addEventListener('dragstart', handleDragStart);

        return () => {
            document.removeEventListener('contextmenu', handleContextMenu, true);
            document.removeEventListener('keydown', handleKeyDown, true);
            document.removeEventListener('dragstart', handleDragStart);
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

          [data-allow-image-interaction="true"],
          [data-allow-image-interaction="true"] * {
            pointer-events: auto !important;
            user-select: none !important;
            -webkit-user-select: none !important;
            touch-action: auto !important;
          }

          [data-allow-image-interaction="true"] img,
          [data-allow-image-interaction="true"] svg {
            -webkit-user-drag: element !important;
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
