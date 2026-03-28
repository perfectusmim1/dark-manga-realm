const DEVICE_INSTALLATION_KEY = 'toonparrot_device_installation_id';
const DEVICE_COOKIE_KEY = 'toonparrot_device_id';
const DEVICE_DB_NAME = 'toonparrot-device';
const DEVICE_DB_STORE = 'identity';
const DEVICE_DB_RECORD = 'installation-id';
const WINDOW_NAME_PREFIX = 'toonparrot:device:';

const sha256Hex = async (value: string) => {
    const encoded = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
};

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';

const normalizeStoredId = (value?: string | null) => {
    const trimmed = value?.trim();
    return trimmed && trimmed.length >= 16 ? trimmed : null;
};

const readCookieValue = () => {
    if (!isBrowser()) {
        return null;
    }

    const cookie = document.cookie
        .split('; ')
        .find((entry) => entry.startsWith(`${DEVICE_COOKIE_KEY}=`));

    return normalizeStoredId(cookie ? decodeURIComponent(cookie.split('=').slice(1).join('=')) : null);
};

const writeCookieValue = (value: string) => {
    if (!isBrowser()) {
        return;
    }

    document.cookie = `${DEVICE_COOKIE_KEY}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365 * 5}; SameSite=Lax`;
};

const readWindowNameValue = () => {
    if (!isBrowser()) {
        return null;
    }

    return normalizeStoredId(
        window.name.startsWith(WINDOW_NAME_PREFIX)
            ? window.name.slice(WINDOW_NAME_PREFIX.length)
            : null,
    );
};

const writeWindowNameValue = (value: string) => {
    if (!isBrowser()) {
        return;
    }

    window.name = `${WINDOW_NAME_PREFIX}${value}`;
};

const openDeviceDb = async () => {
    if (!isBrowser() || typeof indexedDB === 'undefined') {
        return null;
    }

    return await new Promise<IDBDatabase | null>((resolve) => {
        const request = indexedDB.open(DEVICE_DB_NAME, 1);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(DEVICE_DB_STORE)) {
                db.createObjectStore(DEVICE_DB_STORE);
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });
};

const readIndexedDbValue = async () => {
    const db = await openDeviceDb();
    if (!db) {
        return null;
    }

    return await new Promise<string | null>((resolve) => {
        const transaction = db.transaction(DEVICE_DB_STORE, 'readonly');
        const store = transaction.objectStore(DEVICE_DB_STORE);
        const request = store.get(DEVICE_DB_RECORD);

        request.onsuccess = () => resolve(normalizeStoredId(request.result));
        request.onerror = () => resolve(null);
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => db.close();
    });
};

const writeIndexedDbValue = async (value: string) => {
    const db = await openDeviceDb();
    if (!db) {
        return;
    }

    await new Promise<void>((resolve) => {
        const transaction = db.transaction(DEVICE_DB_STORE, 'readwrite');
        const store = transaction.objectStore(DEVICE_DB_STORE);
        store.put(value, DEVICE_DB_RECORD);
        transaction.oncomplete = () => {
            db.close();
            resolve();
        };
        transaction.onerror = () => {
            db.close();
            resolve();
        };
        transaction.onabort = () => {
            db.close();
            resolve();
        };
    });
};

const writeInstallationIdEverywhere = async (value: string) => {
    if (!isBrowser()) {
        return;
    }

    try {
        window.localStorage.setItem(DEVICE_INSTALLATION_KEY, value);
    } catch {
        // Ignore storage failures and continue with the other stores.
    }

    writeCookieValue(value);
    writeWindowNameValue(value);
    await writeIndexedDbValue(value);
};

export const getOrCreateDeviceInstallationId = async () => {
    if (!isBrowser()) {
        return 'server-render';
    }

    const localStorageValue = (() => {
        try {
            return normalizeStoredId(window.localStorage.getItem(DEVICE_INSTALLATION_KEY));
        } catch {
            return null;
        }
    })();

    const cookieValue = readCookieValue();
    const windowNameValue = readWindowNameValue();
    const indexedDbValue = await readIndexedDbValue();
    const existing = localStorageValue || cookieValue || indexedDbValue || windowNameValue;

    if (existing) {
        await writeInstallationIdEverywhere(existing);
        return existing;
    }

    const created = crypto.randomUUID();
    await writeInstallationIdEverywhere(created);
    return created;
};

const getCanvasFingerprint = async () => {
    if (!isBrowser()) {
        return 'server-canvas';
    }

    try {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
            return 'no-canvas-context';
        }

        canvas.width = 280;
        canvas.height = 72;
        context.textBaseline = 'alphabetic';
        context.fillStyle = '#0f172a';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.font = '700 17px "Segoe UI"';
        context.fillStyle = '#f8fafc';
        context.fillText('toonparrot-device-check', 12, 28);
        context.font = '400 13px serif';
        context.fillStyle = '#38bdf8';
        context.fillText(`${navigator.language}|${Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown'}`, 12, 52);

        return await sha256Hex(canvas.toDataURL());
    } catch {
        return 'canvas-unavailable';
    }
};

const getStableDeviceSeed = async () => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
    const screenInfo = typeof window !== 'undefined'
        ? `${window.screen.colorDepth}|${window.screen.pixelDepth}|${window.devicePixelRatio || 1}`
        : 'server';
    const languages = Array.isArray(navigator.languages) && navigator.languages.length > 0
        ? navigator.languages.join(',')
        : navigator.language || 'unknown';
    const canvasFingerprint = await getCanvasFingerprint();

    return [
        navigator.platform || 'unknown',
        navigator.vendor || 'unknown',
        languages,
        `${navigator.hardwareConcurrency || 0}`,
        `${navigator.maxTouchPoints || 0}`,
        `${(navigator as Navigator & { deviceMemory?: number }).deviceMemory || 0}`,
        timezone,
        screenInfo,
        canvasFingerprint,
    ].join('|');
};

export const getDeviceIdentity = async () => {
    const installationId = await getOrCreateDeviceInstallationId();
    const stableSeed = await getStableDeviceSeed();

    return {
        deviceInstallationId: installationId,
        deviceHash: await sha256Hex(stableSeed),
    };
};
