import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { consumeRouteForceTopFlag } from '@/lib/scrollRestoration';

const SCROLL_STORE_KEY = 'toonparrot:scroll-positions:v1';
const PENDING_RESTORE_ROUTE_KEY = 'toonparrot:pending-scroll-route:v1';
const MAX_SCROLL_STORE_ENTRIES = 120;
const RESTORE_RETRY_MS = 90;
const MAX_RESTORE_ATTEMPTS = 80;
const RESTORE_TOLERANCE_PX = 24;

interface ScrollPositionEntry {
    x: number;
    y: number;
    updatedAt: number;
}

type ScrollPositionStore = Record<string, ScrollPositionEntry>;

const isReaderPath = (pathname: string) => /^\/manga\/[^/]+\/chapter\/[^/]+$/.test(pathname);

const readScrollStore = (): ScrollPositionStore => {
    if (typeof window === 'undefined') {
        return {};
    }

    try {
        const raw = window.sessionStorage.getItem(SCROLL_STORE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw) as ScrollPositionStore;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writeScrollStore = (store: ScrollPositionStore) => {
    if (typeof window === 'undefined') {
        return;
    }

    const sortedEntries = Object.entries(store)
        .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
        .slice(0, MAX_SCROLL_STORE_ENTRIES);

    const trimmedStore = Object.fromEntries(sortedEntries);
    window.sessionStorage.setItem(SCROLL_STORE_KEY, JSON.stringify(trimmedStore));
};

const saveScrollPosition = (routeKey: string) => {
    if (typeof window === 'undefined' || !routeKey) {
        return;
    }

    const store = readScrollStore();
    store[routeKey] = {
        x: window.scrollX,
        y: window.scrollY,
        updatedAt: Date.now(),
    };
    writeScrollStore(store);
};

const getSavedScrollPosition = (routeKey: string) => {
    if (!routeKey) {
        return null;
    }

    return readScrollStore()[routeKey] || null;
};

const markPendingRestoreRoute = (routeKey: string) => {
    if (typeof window === 'undefined' || !routeKey) {
        return;
    }

    window.sessionStorage.setItem(PENDING_RESTORE_ROUTE_KEY, routeKey);
};

const getPendingRestoreRoute = () => {
    if (typeof window === 'undefined') {
        return null;
    }

    return window.sessionStorage.getItem(PENDING_RESTORE_ROUTE_KEY);
};

const clearPendingRestoreRoute = () => {
    if (typeof window === 'undefined') {
        return;
    }

    window.sessionStorage.removeItem(PENDING_RESTORE_ROUTE_KEY);
};

const getInitialNavigationType = () => {
    if (typeof window === 'undefined' || typeof window.performance?.getEntriesByType !== 'function') {
        return null;
    }

    const [entry] = window.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    return entry?.type || null;
};

const ScrollToTop = () => {
    const location = useLocation();
    const navigationType = useNavigationType();
    const routeKey = useMemo(
        () => `${location.pathname}${location.search}`,
        [location.pathname, location.search],
    );
    const isReaderRoute = useMemo(() => isReaderPath(location.pathname), [location.pathname]);
    const previousRouteKeyRef = useRef(routeKey);
    const hasMountedRef = useRef(false);
    const initialNavigationTypeRef = useRef<string | null>(
        typeof window === 'undefined' ? null : getInitialNavigationType(),
    );
    const isRestoringRef = useRef(false);

    useEffect(() => {
        const previousScrollRestoration = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';

        return () => {
            window.history.scrollRestoration = previousScrollRestoration;
        };
    }, []);

    useEffect(() => {
        if (isReaderRoute) {
            isRestoringRef.current = false;
            previousRouteKeyRef.current = routeKey;
            return;
        }

        let frameId: number | null = null;

        const persist = () => {
            if (isRestoringRef.current) {
                return;
            }

            saveScrollPosition(routeKey);
        };

        const handlePageExit = () => {
            saveScrollPosition(routeKey);
            markPendingRestoreRoute(routeKey);
        };

        const handleScroll = () => {
            if (frameId !== null) {
                return;
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                persist();
            });
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('pagehide', handlePageExit);
        window.addEventListener('beforeunload', handlePageExit);

        return () => {
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }

            persist();
            window.removeEventListener('scroll', handleScroll);
            window.removeEventListener('pagehide', handlePageExit);
            window.removeEventListener('beforeunload', handlePageExit);
        };
    }, [isReaderRoute, routeKey]);

    useLayoutEffect(() => {
        if (isReaderRoute) {
            isRestoringRef.current = false;
            previousRouteKeyRef.current = routeKey;
            return;
        }

        const isFirstMount = !hasMountedRef.current;
        hasMountedRef.current = true;

        previousRouteKeyRef.current = routeKey;

        const shouldForceTop = consumeRouteForceTopFlag(routeKey);
        const savedPosition = getSavedScrollPosition(routeKey);
        const pendingRestoreRoute = isFirstMount ? getPendingRestoreRoute() : null;
        const shouldRestoreInitialScroll = isFirstMount
            && Boolean(savedPosition)
            && (
                pendingRestoreRoute === routeKey
                || initialNavigationTypeRef.current === 'back_forward'
            );
        const shouldRestoreHistoryScroll = !isFirstMount
            && navigationType === 'POP'
            && Boolean(savedPosition);
        const shouldRestore = !shouldForceTop && (shouldRestoreInitialScroll || shouldRestoreHistoryScroll);

        let timeoutId: number | null = null;
        let cancelled = false;

        const clearPendingRestore = () => {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
                timeoutId = null;
            }
        };

        if (!shouldRestore) {
            if (isFirstMount) {
                clearPendingRestoreRoute();
            }

            isRestoringRef.current = false;
            if (shouldForceTop || !isFirstMount) {
                window.scrollTo({
                    top: 0,
                    left: 0,
                    behavior: 'auto',
                });
                saveScrollPosition(routeKey);
            }

            return () => {
                cancelled = true;
                clearPendingRestore();
            };
        }

        isRestoringRef.current = true;

        const restoreScroll = (attempt = 0) => {
            if (cancelled || !savedPosition) {
                return;
            }

            const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
            const targetTop = Math.min(savedPosition.y, maxScrollTop);
            const targetLeft = Math.max(0, savedPosition.x);
            const canReachSavedOffset = maxScrollTop + RESTORE_TOLERANCE_PX >= savedPosition.y;

            window.scrollTo({
                top: targetTop,
                left: targetLeft,
                behavior: 'auto',
            });

            const reachedTarget = Math.abs(window.scrollY - targetTop) <= 2;
            if ((canReachSavedOffset && reachedTarget) || attempt >= MAX_RESTORE_ATTEMPTS - 1) {
                isRestoringRef.current = false;
                clearPendingRestoreRoute();
                saveScrollPosition(routeKey);
                return;
            }

            timeoutId = window.setTimeout(() => restoreScroll(attempt + 1), RESTORE_RETRY_MS);
        };

        timeoutId = window.setTimeout(() => restoreScroll(), 0);

        return () => {
            cancelled = true;
            isRestoringRef.current = false;
            clearPendingRestore();
        };
    }, [isReaderRoute, routeKey]);

    return null;
};

export default ScrollToTop;
