import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TriangleAlert, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import {
    getSiteSecuritySettings,
    SiteSecuritySettings,
    subscribeToSiteSecuritySettings,
} from '@/lib/siteSecurity';

const SECURITY_SETTINGS_DEFAULT: SiteSecuritySettings = {
    devtoolsProtectionEnabled: false,
    adblockWarningEnabled: false,
    updatedAt: null,
    updatedBy: null,
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const runSingleAdBlockProbe = async (): Promise<boolean> => {
    const bait = document.createElement('div');
    bait.className = 'adsbox ad-banner ad-placement ad-container text-ad textads sponsored-content banner-ad';
    bait.setAttribute('aria-hidden', 'true');
    bait.style.cssText = [
        'position:absolute',
        'left:-9999px',
        'top:-9999px',
        'width:1px',
        'height:1px',
        'pointer-events:none',
        'overflow:hidden',
        'z-index:-1',
    ].join(';');

    const probeChild = document.createElement('div');
    probeChild.className = 'pub_300x250 pub_728x90 text-ad google-ad doubleclick ad-unit';
    probeChild.style.cssText = 'width:1px;height:1px;';
    bait.appendChild(probeChild);
    document.body.appendChild(bait);

    await wait(120);

    const computedStyle = window.getComputedStyle(bait);
    const childStyle = window.getComputedStyle(probeChild);

    const detected =
        !document.body.contains(bait) ||
        bait.offsetParent === null ||
        bait.clientHeight === 0 ||
        bait.clientWidth === 0 ||
        computedStyle.display === 'none' ||
        computedStyle.visibility === 'hidden' ||
        childStyle.display === 'none' ||
        childStyle.visibility === 'hidden' ||
        probeChild.clientHeight === 0 ||
        probeChild.clientWidth === 0;

    bait.remove();
    return detected;
};

const detectAdBlocker = async (): Promise<boolean> => {
    const firstPass = await runSingleAdBlockProbe();
    if (firstPass) {
        return true;
    }

    await wait(700);
    return runSingleAdBlockProbe();
};

const AdBlockWarning: React.FC = () => {
    const location = useLocation();
    const [settings, setSettings] = useState<SiteSecuritySettings>(SECURITY_SETTINGS_DEFAULT);
    const [isWarningOpen, setIsWarningOpen] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const hasCheckedSessionRef = useRef(false);

    useEffect(() => {
        let isActive = true;

        void getSiteSecuritySettings()
            .then((loadedSettings) => {
                if (isActive) {
                    setSettings(loadedSettings);
                }
            })
            .catch((error) => {
                console.error('Adblock warning settings could not be loaded:', error);
            });

        const unsubscribe = subscribeToSiteSecuritySettings((nextSettings) => {
            if (isActive) {
                setSettings(nextSettings);
                if (!nextSettings.adblockWarningEnabled) {
                    setIsWarningOpen(false);
                }
            }
        });

        return () => {
            isActive = false;
            unsubscribe();
        };
    }, []);

    useEffect(() => {
        if (!settings.adblockWarningEnabled) {
            hasCheckedSessionRef.current = false;
            setIsWarningOpen(false);
            return;
        }

        if (isDismissed || hasCheckedSessionRef.current || location.pathname.startsWith('/admin')) {
            return;
        }

        let isActive = true;
        hasCheckedSessionRef.current = true;

        void detectAdBlocker()
            .then((detected) => {
                if (isActive && detected) {
                    setIsWarningOpen(true);
                }
            })
            .catch((error) => {
                console.error('Adblock detection failed:', error);
            });

        return () => {
            isActive = false;
        };
    }, [isDismissed, location.pathname, settings.adblockWarningEnabled]);

    return (
        <Dialog
            open={isWarningOpen}
            onOpenChange={(open) => {
                setIsWarningOpen(open);
                if (!open) {
                    setIsDismissed(true);
                }
            }}
        >
            <DialogContent className="max-w-[560px] overflow-hidden border-amber-500/20 bg-card/95 p-0 backdrop-blur-xl">
                <div className="relative overflow-hidden p-6">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.12),transparent_36%)]" />
                    <div className="relative space-y-5">
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-amber-500/20 bg-amber-500/10 text-amber-400">
                                <TriangleAlert className="h-6 w-6" />
                            </div>
                            <DialogHeader className="space-y-2 text-left">
                                <DialogTitle className="text-xl font-bold">
                                    Reklam Engelleyici Algılandı
                                </DialogTitle>
                                <DialogDescription className="text-sm leading-6 text-muted-foreground">
                                    Bu site tamamen reklamsızdır sadece bazı özellikleri adblocker bozduğu için kapatmanız deneyim açısından en iyisi olacaktır.
                                </DialogDescription>
                            </DialogHeader>
                        </div>

                        <div className="rounded-2xl border border-border/60 bg-background/70 p-4">
                            <div className="flex items-start gap-3">
                                <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                                    <Wrench className="h-4 w-4" />
                                </div>
                                <div className="space-y-1">
                                    <p className="text-sm font-medium">Neden bu uyarıyı görüyorsun?</p>
                                    <p className="text-sm text-muted-foreground">
                                        Okuyucu içindeki bazı etkileşimler, yorum akışları ve özel arayüz katmanları agresif reklam engelleyiciler tarafından yanlışlıkla filtrelenebiliyor.
                                    </p>
                                </div>
                            </div>
                        </div>

                        <DialogFooter className="sm:justify-between">
                            <p className="text-xs text-muted-foreground">
                                Uyarıyı kapatsan bile sonraki site girişinde tekrar gösterilir.
                            </p>
                            <Button
                                onClick={() => {
                                    setIsDismissed(true);
                                    setIsWarningOpen(false);
                                }}
                            >
                                Tamam, kapat
                            </Button>
                        </DialogFooter>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

export default AdBlockWarning;
