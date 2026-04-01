const FORCE_TOP_ROUTE_STORE_KEY = 'toonparrot:force-top-routes:v1';
const MAX_FORCE_TOP_ROUTE_ENTRIES = 32;

type ForceTopRouteStore = Record<string, number>;

const isBrowser = () => typeof window !== 'undefined';

const readForceTopRouteStore = (): ForceTopRouteStore => {
    if (!isBrowser()) {
        return {};
    }

    try {
        const raw = window.sessionStorage.getItem(FORCE_TOP_ROUTE_STORE_KEY);
        if (!raw) {
            return {};
        }

        const parsed = JSON.parse(raw) as ForceTopRouteStore;
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writeForceTopRouteStore = (store: ForceTopRouteStore) => {
    if (!isBrowser()) {
        return;
    }

    const trimmedStore = Object.fromEntries(
        Object.entries(store)
            .sort(([, left], [, right]) => right - left)
            .slice(0, MAX_FORCE_TOP_ROUTE_ENTRIES),
    );

    window.sessionStorage.setItem(FORCE_TOP_ROUTE_STORE_KEY, JSON.stringify(trimmedStore));
};

export const buildRouteKey = (pathname: string, search = '') => `${pathname}${search}`;

export const markRouteToForceTopOnNextVisit = (routeKey: string) => {
    if (!isBrowser() || !routeKey) {
        return;
    }

    const store = readForceTopRouteStore();
    store[routeKey] = Date.now();
    writeForceTopRouteStore(store);
};

export const consumeRouteForceTopFlag = (routeKey: string) => {
    if (!isBrowser() || !routeKey) {
        return false;
    }

    const store = readForceTopRouteStore();
    if (!store[routeKey]) {
        return false;
    }

    delete store[routeKey];
    writeForceTopRouteStore(store);
    return true;
};
